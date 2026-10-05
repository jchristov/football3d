import test from 'node:test';
import assert from 'node:assert/strict';
import { heatLevels, passNetwork, topPassers, topRunners, teamDistance, drawHeat, drawShots, drawNetwork } from '../src/analysis.js';
import { HEAT_W, HEAT_H, normPos } from '../src/stats.js';
import { makeGame, startCpuMatch, runUntil, step, seedRandom, resetGlobals } from './helpers.js';
import { PITCH } from '../src/constants.js';

test.beforeEach(() => resetGlobals());

// a canvas context that records nothing but accepts every call
const ctx = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });

function played(seed = 41, length = 90) {
  seedRandom(seed);
  const g = makeGame();
  startCpuMatch(g, { length });
  runUntil(g, () => g.state === 'ended' || g.state === 'halftime', 150);
  if (g.state === 'halftime') g.endHalftime();
  runUntil(g, () => g.state === 'ended', 200);
  return g;
}

test('positions are normalised to the direction of attack', () => {
  const g = makeGame(); startCpuMatch(g, { length: 60 });
  const p = { team: 0, pos: { x: PITCH.hl, z: -PITCH.hw } };
  assert.deepEqual(normPos(p), { x: 1, z: -1 });
  assert.equal(normPos({ team: 1, pos: { x: -PITCH.hl, z: 0 } }).x, 1, 'the other team attacks the other way');
  assert.equal(normPos({ team: 0, pos: { x: 9999, z: 9999 } }).x, 1, 'clamped');
});

test('the heat map adds up to the time the players spent on the pitch', () => {
  const g = played();
  for (const t of [0, 1]) {
    const total = g.stats.heat[t].reduce((a, v) => a + v, 0);
    const secs = [...g.stats.players.values()].filter((r) => r.team === t).reduce((a, r) => a + r.seconds, 0);
    assert.ok(Math.abs(total - secs) < 1, `team ${t}: ${total} vs ${secs}`);
    assert.equal(g.stats.heat[t].length, HEAT_W * HEAT_H);
  }
  const lv = heatLevels(g.stats.heat[0]);
  assert.ok(Math.max(...lv) === 1 && Math.min(...lv) >= 0);
});

test('every shot is logged with its position, and goals are marked on the shot map', () => {
  const g = played(7, 120);
  const shots = g.stats.shots[0] + g.stats.shots[1];
  assert.equal(g.stats.shotLog.length, shots);
  for (const s of g.stats.shotLog) assert.ok(Math.abs(s.x) <= 1 && Math.abs(s.z) <= 1);
  const goals = g.stats.shotLog.filter((s) => s.goal).length;
  const real = g.stats.goals.filter((x) => !x.own).length;
  assert.ok(goals <= real && goals >= Math.max(0, real - 2), `${goals} marked goals of ${real}`);
});

test('completed passes build the passing network; distances are recorded', () => {
  const g = played(13, 120);
  const total = [...g.stats.pairs.values()].reduce((a, n) => a + n, 0);
  assert.equal(total, g.stats.passesOk[0] + g.stats.passesOk[1], 'every completed pass is in the network');
  assert.ok(total > 0);
  const net = passNetwork(g.stats, 0);
  assert.ok(net.nodes.length >= 5);
  for (const n of net.nodes) assert.ok(Math.abs(n.x) <= 1 && Math.abs(n.z) <= 1);
  assert.ok(net.edges.every((e) => net.nodes.some((n) => n.slot === e.from) && net.nodes.some((n) => n.slot === e.to)));
  assert.ok(teamDistance(g.stats, 0) > 500, `${teamDistance(g.stats, 0)} m`);
  const tp = topPassers(g.stats, 0); assert.ok(tp.length >= 1 && tp[0].ok >= (tp[1]?.ok ?? 0));
  const tr = topRunners(g.stats, 0); assert.ok(tr.length === 3 && tr[0].meters >= tr[1].meters);
});

test('the three pitch drawings run on a real match without errors', () => {
  const g = played(3, 60);
  const colors = ['#1e6bff', '#e4002b'];
  drawHeat(ctx(), 250, 160, g.stats.heat[0], colors[0]);
  drawShots(ctx(), 510, 170, g.stats.shotLog, colors);
  drawNetwork(ctx(), 250, 160, passNetwork(g.stats, 1), colors[1]);
  drawNetwork(ctx(), 250, 160, { nodes: [], edges: [] }, colors[1]);
});
