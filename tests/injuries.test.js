import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, startCpuMatch, runUntil, step, seedRandom, resetGlobals } from './helpers.js';
import { settings } from '../src/settings.js';
import { Discipline } from '../src/teams.js';

test.beforeEach(() => { resetGlobals(); });

function ready(seed = 8, over = {}) {
  seedRandom(seed);
  const g = makeGame({ injuries: true });
  startCpuMatch(g, { length: 600, ...over });
  runUntil(g, () => g.state === 'playing', 10);
  step(g, 1);
  return g;
}

test('an injured player limps: slower and he cannot sprint', () => {
  const g = ready();
  const p = g.teams[0][2];
  const run = (q) => { q.pos.set(-10, 0, 0); q.vel.set(0, 0, 0); q.stunT = 0; for (let i = 0; i < 120; i++) q.move(1, 0, true, 1 / 60); return q.speed; };
  const healthy = run(p);
  g.lineups.injure(0, p.squadSlot);
  assert.equal(p.injured, true);
  const hurt = run(p);
  assert.ok(hurt < healthy * 0.6, `${hurt} vs ${healthy}`);
});

test('a hard foul can injure the victim; at most two players per team and never with the setting off', () => {
  const g = ready();
  let hurt = 0;
  for (let i = 0; i < 400; i++) { const v = g.teams[0][1 + (i % 4)]; v.injured = false; g.lineups.injured[0].clear(); if (g.rules.maybeInjure(v, 0.5)) hurt++; }
  assert.ok(hurt > 100 && hurt < 300, `${hurt} of 400`);
  // cap
  g.lineups.injured[1].clear();
  const a = g.teams[1][1], b = g.teams[1][2], c = g.teams[1][3];
  for (const p of [a, b, c]) { p.injured = false; g.rules.maybeInjure(p, 1); }
  assert.equal(g.lineups.injured[1].size, 2);
  settings.injuries = false;
  const d = g.teams[0][4]; g.lineups.injured[0].clear(); d.injured = false;
  assert.equal(g.rules.maybeInjure(d, 1), false);
});

test('the CPU replaces an injured player at once with the freshest fit bench player; he cannot come back', () => {
  const g = ready(9);
  const L = g.lineups, victim = g.teams[1][2], outName = victim.name;
  const slot = victim.squadSlot;
  g.injure(victim);
  assert.equal(L.subs[1], 1, 'a substitution was made');
  assert.ok(L.bench[1].includes(slot));
  assert.notEqual(g.teams[1][2].name, outName);
  const k = L.bench[1].indexOf(slot);
  assert.equal(L.substitute(1, 3, k), null, 'the injured player stays out');
  assert.equal(g.events.some((e) => e.type === 'injury' && e.team === 1), true);
});

test('a human is not substituted automatically', () => {
  seedRandom(5);
  const g = makeGame({ injuries: true });
  startCpuMatch(g, { mode: '1p', length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  const v = g.teams[0][2];
  g.injure(v);
  assert.equal(g.lineups.subs[0], 0);
  assert.equal(v.injured, true);
});

test('an injured player stays injured through identity refreshes, and a substitute is fit', () => {
  const g = ready(3, { mode: '1p' });
  const v = g.teams[0][2];
  g.injure(v);
  g.lineups.applyIdentities(0);
  assert.equal(v.injured, true);
  const bk = g.lineups.bestBenchIndex(0);
  assert.ok(g.substitute(0, v.index, bk));
  assert.equal(g.teams[0][2].injured, false);
});

test('players hurt in a tournament match miss the next one', () => {
  const d = new Discipline();
  d.record({ yellows: {}, sent: [3], injured: [5] });
  assert.deepEqual(d.unavailable().sort(), [3, 5]);
  assert.equal(d.rows().find((r) => r.slot === 5).injured, true);
  d.record({ yellows: {}, sent: [], injured: [] });
  assert.deepEqual(d.unavailable(), []);
});

test('full matches with a lot of injuries still finish', () => {
  seedRandom(77);
  const g = makeGame({ injuries: true });
  startCpuMatch(g, { length: 90 });
  const real = g.rules.maybeInjure.bind(g.rules);
  g.rules.maybeInjure = (v, c) => real(v, Math.min(1, c * 8));
  runUntil(g, () => g.state === 'ended' || g.state === 'halftime', 120);
  if (g.state === 'halftime') g.endHalftime();
  runUntil(g, () => g.state === 'ended', 200);
  assert.equal(g.state, 'ended');
  for (const p of g.all) assert.ok(Number.isFinite(p.pos.x));
});
