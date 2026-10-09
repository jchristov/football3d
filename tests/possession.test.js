import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runUntil, step, seedRandom, resetGlobals } from './helpers.js';

test.beforeEach(() => resetGlobals());

function setup() {
  seedRandom(5);
  const g = makeGame();
  g.startMatch({ mode: '1p', teams: [0, 1], diff: 'normal', length: 120, knockout: false, env: { time: 'day', weather: 'clear' } });
  runUntil(g, () => g.state === 'playing', 10); step(g, 0.3);
  for (const o of g.all) o.pos.set(o.pos.x, 0, o.pos.z + 40);
  return g;
}

test('a carrier running with the ball keeps it', () => {
  const g = setup();
  const p = g.teams[0].find((x) => !x.isGK);
  p.place(-10, 0, 0); p.touchCd = 0; p.kickCd = 0; p.facing = 0;
  g.ball.reset(-9, 0);
  g.ball.owner = p; p.vel.set(5, 0, 0);
  let kept = 0;
  for (let i = 0; i < 120; i++) {
    p.vel.set(5, 0, 0); p.pos.z = 0;
    step(g, 1 / 60);
    if (g.ball.owner === p) kept++;
  }
  assert.ok(kept > 100, `kept ${kept}/120`);
});

test('a defender cannot rob a carrier shielding the ball in every single frame', () => {
  const g = setup();
  const p = g.teams[0].find((x) => !x.isGK), d = g.teams[1].find((x) => !x.isGK);
  p.place(0, 0, 0); p.facing = 0; d.place(-0.6, 0, 0); d.facing = 0; // the carrier's body is between defender and ball
  g.ball.reset(0.8, 0); g.ball.owner = p;
  let stolen = 0;
  for (let i = 0; i < 20; i++) { p.touchCd = 0; d.touchCd = 0; g.contacts(); if (g.ball.owner === d) { stolen++; g.ball.owner = p; } }
  assert.ok(stolen < 8, `stolen ${stolen}/20`);
});

test('players of different teams still get pushed apart and the carrier is pushed less', () => {
  const g = setup();
  const a = g.teams[0].find((x) => !x.isGK), b = g.teams[1].find((x) => !x.isGK);
  a.place(0, 0, 0); b.place(0.4, 0, 0); g.ball.owner = a;
  g.separate();
  assert.ok(b.pos.x - a.pos.x >= 0.79);
  assert.ok(Math.abs(a.pos.x) < Math.abs(b.pos.x - 0.4));
});
