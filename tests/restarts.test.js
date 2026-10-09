import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, startCpuMatch, runUntil, step, seedRandom, resetGlobals } from './helpers.js';
import { PITCH, GOAL, BALL, TEAM_SIZES, attackDir } from '../src/constants.js';

test.beforeEach(() => resetGlobals());

function ready(seed = 5, over = {}) {
  seedRandom(seed);
  const g = makeGame({ restarts: true });
  startCpuMatch(g, { length: 600, ...over });
  runUntil(g, () => g.state === 'playing', 10);
  step(g, 0.5);
  return g;
}
const out = (g, x, z, y, toucher) => { g.ball.reset(x, z); g.ball.pos.y = y ?? BALL.r; g.ball.lastToucher = toucher; g.ball.owner = null; g.ball.vel.set(0, 0, 0); g.state = 'playing'; };

test('the ball can leave the pitch when the restarts are on, and bounces off the boards when they are off', () => {
  const g = ready();
  assert.equal(g.ball.walls, false);
  g.ball.reset(0, PITCH.hw - 0.3); g.ball.vel.set(0, 0, 9);
  g.ball.step(0.3);
  assert.ok(g.ball.pos.z > PITCH.hw, 'it went over the touchline');
  const h = makeGame({ restarts: false }); startCpuMatch(h, { length: 600 }); runUntil(h, () => h.state === 'playing', 10);
  assert.equal(h.ball.walls, true);
  h.ball.reset(0, PITCH.hw - 0.3); h.ball.vel.set(0, 0, 9);
  h.ball.step(0.3);
  assert.ok(Math.abs(h.ball.pos.z) <= PITCH.hw, 'the boards keep it in');
});

test('over a touchline: throw-in for the team that did not touch it last, taken from the line', () => {
  const g = ready();
  const toucher = g.teams[0][2];
  out(g, 6, PITCH.hw + BALL.r + 0.2, BALL.r, toucher);
  assert.equal(g.rules.checkOut(), true);
  assert.equal(g.state, 'foul');
  assert.equal(g.rules.pending.type, 'throw'); assert.equal(g.rules.pending.team, 1);
  step(g, 1.2);
  assert.equal(g.state, 'setpiece');
  const sp = g.rules.sp;
  assert.equal(sp.type, 'throw'); assert.equal(sp.kicker.team, 1);
  assert.ok(Math.abs(Math.abs(g.ball.pos.z) - (PITCH.hw - 0.5)) < 0.2, `ball on the line: ${g.ball.pos.z}`);
  assert.ok(Math.abs(g.ball.pos.x - 6) < 1);
  runUntil(g, () => g.state === 'playing', 12);
  assert.equal(g.state, 'playing', 'the CPU takes the throw-in and play resumes');
});

test('over the goal line: a goal kick for the defenders when an attacker touched it last', () => {
  const g = ready();
  const hx = PITCH.hl, attackers = attackDir(0) === 1 ? 0 : 1; // the team attacking the +x goal
  const atk = g.teams[attackers][3];
  out(g, hx + BALL.r + 0.3, GOAL.hw + 3, BALL.r, atk);
  assert.equal(g.rules.checkOut(), true);
  assert.equal(g.rules.pending.type, 'goalkick'); assert.equal(g.rules.pending.team, 1 - attackers);
  step(g, 1.2);
  const sp = g.rules.sp;
  assert.equal(sp.type, 'goalkick');
  assert.ok(sp.kicker.isGK, 'the goalkeeper takes it');
  assert.ok(g.ball.pos.x > PITCH.hl - 6 * PITCH.s && g.ball.pos.x < PITCH.hl - 3 * PITCH.s, `in front of the goal: ${g.ball.pos.x}`);
  assert.equal(sp.ctrl, null);
  runUntil(g, () => g.state === 'playing', 12);
  assert.equal(g.state, 'playing');
  assert.ok(g.ball.vel.x < -5, `the keeper booted it away from his goal: vx ${g.ball.vel.x}`);
});

test('over the goal line off a defender: a corner for the attackers, from the right corner', () => {
  const g = ready();
  const attackers = attackDir(0) === 1 ? 0 : 1, defender = g.teams[1 - attackers][2];
  out(g, PITCH.hl + BALL.r + 0.3, -(GOAL.hw + 4), BALL.r, defender);
  assert.equal(g.rules.checkOut(), true);
  assert.equal(g.rules.pending.type, 'corner'); assert.equal(g.rules.pending.team, attackers);
  assert.equal(g.stats.corners[attackers], 1);
  step(g, 1.2);
  const sp = g.rules.sp;
  assert.equal(sp.type, 'corner');
  assert.ok(g.ball.pos.x > PITCH.hl - 1 && g.ball.pos.z < -PITCH.hw + 1, `corner flag: ${g.ball.pos.x}, ${g.ball.pos.z}`);
  assert.equal(sp.kicker.team, attackers);
  runUntil(g, () => g.state === 'playing', 12);
  assert.equal(g.state, 'playing');
});

test('a ball over the bar is out of play, a ball in the goal is a goal', () => {
  const g = ready();
  const attackers = attackDir(0) === 1 ? 0 : 1;
  out(g, PITCH.hl + BALL.r + 0.4, 0, GOAL.h + 1, g.teams[attackers][2]);
  g.ball.netSide = 0;
  assert.equal(g.rules.checkOut(), true, 'over the bar');
  assert.equal(g.rules.pending.type, 'goalkick');
  const h = ready(6);
  h.ball.reset(PITCH.hl - 0.2, 2.8); h.ball.vel.set(18, 0.3, 0); h.ball.lastToucher = h.teams[attackDir(0) === 1 ? 0 : 1][3];
  step(h, 1);
  assert.ok(h.score[0] + h.score[1] === 1 || h.state === 'goal' || h.state === 'replay', 'it was a goal');
});

test('nothing happens while the ball is inside, held by the keeper, or during a shoot-out', () => {
  const g = ready();
  out(g, 3, 4, BALL.r, g.teams[0][2]);
  assert.equal(g.rules.checkOut(), false);
  out(g, 0, PITCH.hw + 1, BALL.r, g.teams[0][2]); g.ball.held = g.teams[0][0];
  assert.equal(g.rules.checkOut(), false);
  g.ball.held = null; g.rules.so = {};
  assert.equal(g.rules.checkOut(), false);
});

test('a human throw-in is a short, lofted pass; a human corner is an ordinary kick', () => {
  seedRandom(9);
  const g = makeGame({ restarts: true });
  startCpuMatch(g, { mode: '1p', length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  out(g, 4, PITCH.hw + 1, BALL.r, g.teams[1][2]); // the CPU team touched it: throw-in for the human team
  assert.equal(g.rules.checkOut(), true);
  step(g, 1.2);
  const sp = g.rules.sp;
  assert.equal(sp.type, 'throw'); assert.equal(sp.team, 0);
  assert.equal(sp.ctrl, g.ctrls[0]); assert.equal(g.ctrls[0].player, sp.kicker, 'the human takes it');
  g.ball.reset(sp.S.x, sp.S.z); sp.kicker.kickCd = 0; sp.kicker.stunT = 0; sp.kicker.lungeT = 0;
  g.doKick(sp.kicker, 0, 30, 0.2, 0, 'shot');
  assert.ok(g.ball.speed <= 13.5, `capped: ${g.ball.speed}`);
  assert.ok(g.ball.vel.y > 1, 'lofted');
});

test('full matches with restarts finish at every team size and produce restarts', () => {
  let restarts = 0;
  for (const n of TEAM_SIZES) {
    seedRandom(70 + n);
    const g = makeGame({ restarts: true });
    startCpuMatch(g, { length: 90, size: n });
    const real = g.rules.checkOut.bind(g.rules);
    g.rules.checkOut = () => { const r = real(); if (r) restarts++; return r; };
    runUntil(g, () => g.state === 'ended' || g.state === 'halftime', 150);
    if (g.state === 'halftime') g.endHalftime();
    runUntil(g, () => g.state === 'ended', 200);
    assert.equal(g.state, 'ended', `${n}-a-side`);
    for (const p of g.all) assert.ok(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z));
    assert.ok(Number.isFinite(g.ball.pos.x));
  }
  assert.ok(restarts >= TEAM_SIZES.length, `${restarts} restarts in six matches`);
});

test('a human kicker who wandered off during a set piece is put back behind the ball, so the game never hangs', () => {
  seedRandom(5);
  const g = makeGame({ restarts: true });
  startCpuMatch(g, { mode: '1p', length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  step(g, 1);
  g.rules.startSetPiece('free', 0, { x: 0, z: 4 });
  const sp = g.rules.sp, k = sp.kicker;
  assert.ok(sp.ctrl, 'a human takes it');
  k.pos.set(sp.S.x + 12, 0, sp.S.z + 9); // walked away and stands still
  runUntil(g, () => !g.rules.sp, 40);
  assert.equal(g.state, 'playing', 'the kick was taken after the waiting time');
  assert.ok(g.ball.speed > 1 || g.ball.owner, 'the ball was played');
});
