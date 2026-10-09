import test from 'node:test';
import assert from 'node:assert/strict';
import { Discipline, Tournament, YELLOWS_FOR_BAN } from '../src/teams.js';
import { makeGame, startCpuMatch, runUntil, step, seedRandom, resetGlobals } from './helpers.js';

test.beforeEach(() => resetGlobals());

test('a red card is a one-match ban that is served by missing the next match', () => {
  const d = new Discipline();
  assert.deepEqual(d.record({ yellows: {}, sent: [3] }), [3]);
  assert.equal(d.reds[3], 1);
  assert.deepEqual(d.record({ yellows: {}, sent: [] }), [], 'the ban is over after one match');
});

test('three yellow cards over several matches mean a ban, then the count starts again', () => {
  const d = new Discipline();
  assert.deepEqual(d.record({ yellows: { 2: 1 }, sent: [] }), []);
  assert.deepEqual(d.record({ yellows: { 2: 1 }, sent: [] }), []);
  assert.deepEqual(d.record({ yellows: { 2: 1 }, sent: [] }), [2]);
  assert.equal(d.yellows[2], 0);
  assert.equal(YELLOWS_FOR_BAN, 3);
  assert.deepEqual(d.record({ yellows: { 2: 1 }, sent: [] }), []);
  assert.equal(d.yellows[2], 1);
});

test('two yellows in one match are the red card, not counted as yellows as well', () => {
  const d = new Discipline();
  d.record({ yellows: { 4: 2 }, sent: [4] });
  assert.equal(d.yellows[4] || 0, 0); assert.equal(d.reds[4], 1);
  assert.deepEqual(d.suspended, [4]);
});

test('the discipline table lists players with cards or a ban', () => {
  const d = new Discipline();
  assert.deepEqual(d.rows(), []);
  d.record({ yellows: { 2: 1, 5: 2 }, sent: [5, 7] });
  const rows = d.rows();
  assert.deepEqual(rows.map((r) => r.slot), [2, 5, 7]);
  assert.equal(rows.find((r) => r.slot === 2).banned, false);
  assert.equal(rows.find((r) => r.slot === 7).banned, true);
});

test('every tournament has its own discipline record', () => {
  const a = new Tournament('cup', 0, 'normal'), b = new Tournament('league', 0, 'normal');
  a.discipline.record({ sent: [3] });
  assert.deepEqual(b.discipline.suspended, []);
});

test('suspended players do not start or sit on the bench; the match still has a full team', () => {
  for (const n of [3, 5, 11]) {
    seedRandom(3);
    const g = makeGame();
    startCpuMatch(g, { length: 60, size: n, suspended: [1, 2] });
    const L = g.lineups;
    for (const s of [1, 2]) assert.ok(!L.onPitch[0].includes(s) && !L.bench[0].includes(s), `${n}: slot ${s} is unavailable`);
    assert.equal(L.onPitch[0].length, n); assert.equal(g.teams[0].length, n);
    assert.equal(L.onPitch[1].length, n); assert.ok(L.onPitch[1].includes(1), 'the opponent is not affected');
    assert.equal(new Set(g.teams[0].map((p) => p.num)).size, n);
    runUntil(g, () => g.state === 'playing', 10); step(g, 5);
    for (const p of g.all) assert.ok(Number.isFinite(p.pos.x));
  }
});

test('the next match without a ban uses the full squad again', () => {
  const g = makeGame();
  startCpuMatch(g, { length: 60, suspended: [1] });
  assert.ok(!g.lineups.onPitch[0].includes(1));
  startCpuMatch(g, { length: 60 });
  assert.ok(g.lineups.onPitch[0].includes(1));
});

test('the finished match reports the cards of the user team for the tournament', () => {
  seedRandom(21);
  const g = makeGame();
  let got = null;
  startCpuMatch(g, { length: 60, onEnd: (r) => { got = r; } });
  runUntil(g, () => g.state === 'playing', 10);
  const f = g.teams[0][2], v = g.teams[1].find((p) => !p.isGK);
  v.pos.set(0, 0, 3); g.rules.judgeCard = () => 'red'; g.rules.foul(f, v, { hadBall: true, fromBehind: true });
  delete g.rules.judgeCard; // only this one foul is a red card
  step(g, 4);
  const g2 = g;
  const slot = f.squadSlot;
  runUntil(g2, () => g2.state === 'halftime' || g2.state === 'ended', 200);
  if (g2.state === 'halftime') g2.endHalftime();
  runUntil(g2, () => g2.state === 'ended', 200);
  assert.ok(got?.discipline, 'the result carries the discipline report');
  assert.ok(got.discipline.sent.includes(slot), 'the forced red card is reported');
  const d = new Discipline(); d.record(got.discipline);
  assert.ok(d.suspended.includes(slot));
});
