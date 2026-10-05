import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runUntil, step, startCpuMatch, seedRandom, resetGlobals } from './helpers.js';
import { SIDES, attackDir, PITCH, BALL, BALL_R, BALL_SIZES, ballRadius, setBallSize } from '../src/constants.js';
import { Ball } from '../src/ball.js';
import { settings } from '../src/settings.js';

test.beforeEach(() => resetGlobals());

test('attackDir: team 0 attacks +x in the first half and -x in the second', () => {
  assert.equal(attackDir(0), 1); assert.equal(attackDir(1), -1);
  SIDES.flip = -1;
  assert.equal(attackDir(0), -1); assert.equal(attackDir(1), 1);
});

function playToHalftime(seed, length = 60) {
  seedRandom(seed);
  const g = makeGame();
  const whistles = [];
  g.sfx = { ...g.sfx, finalWhistle: () => whistles.push(g.state), whistle() {}, cheer() {}, kick() {}, bounce() {}, post() {}, save() {}, tackle() {}, ooh() {}, groan() {}, setCrowd() {} };
  startCpuMatch(g, { mode: '1p', length });
  g.ctrls[0].enabled = false;
  runUntil(g, () => g.state === 'halftime' || g.state === 'ended', 200);
  return { g, whistles };
}

test('the first half ends at half length with a final whistle and a half-time break', () => {
  const { g, whistles } = playToHalftime(2);
  assert.equal(g.state, 'halftime');
  assert.equal(g.half, 1);
  assert.ok(Math.abs(g.clock - 30) < 1);
  assert.equal(whistles.length, 1, 'one long whistle for the end of the half');
});

test('the second half: teams switch ends, the other team kicks off, and the match ends with another final whistle', () => {
  const { g, whistles } = playToHalftime(3);
  const keepers = [g.teams[0][0].pos.x, g.teams[1][0].pos.x];
  g.endHalftime();
  assert.equal(g.half, 2); assert.equal(SIDES.flip, -1);
  assert.equal(g.state, 'countdown');
  assert.equal(g.kickTeam, 1, 'the team that did not kick off the match starts the second half');
  // keepers now defend the opposite goals
  assert.ok(g.teams[0][0].pos.x > 20 && g.teams[1][0].pos.x < -20);
  assert.ok(Math.sign(g.teams[0][0].pos.x) !== Math.sign(keepers[0]) || Math.abs(keepers[0]) < 1);
  runUntil(g, () => g.state === 'ended', 200);
  assert.equal(g.state, 'ended');
  assert.equal(whistles.length, 2);
  assert.ok(g.result.score.length === 2);
});

test('a goal in the second half counts for the team that scored at the other end', () => {
  const { g } = playToHalftime(4);
  g.endHalftime();
  runUntil(g, () => g.state === 'playing', 20);
  g.rules.reset(); g.resetKickoff(0); runUntil(g, () => g.state === 'playing', 20);
  g.teams[1][0].saveCd = 1e9; g.teams[0][0].saveCd = 1e9;
  const striker = g.teams[0][4];
  striker.place(-(PITCH.hl - 6), 0, Math.PI); // team 0 attacks -x now
  g.ball.reset(-(PITCH.hl - 5), 0); g.ball.owner = striker; g.ball.lastToucher = striker;
  g.ball.vel.set(-25, 0.4, 0);
  const before = g.score.slice();
  step(g, 1.2);
  assert.equal(g.score[0], before[0] + 1, 'team 0 scored in the goal at -x');
  assert.equal(g.score[1], before[1]);
  const goal = g.stats.goals.at(-1);
  assert.equal(goal.team, 0); assert.equal(goal.half, 2); assert.equal(goal.dir, -1);
});

test('a goal that is confirmed just after the half-time mark still leads to the break (no skipped half time)', () => {
  seedRandom(6);
  const g = makeGame();
  startCpuMatch(g, { mode: '1p', length: 60 });
  g.ctrls[0].enabled = false;
  runUntil(g, () => g.state === 'playing', 20);
  g.clock = 29.9; // the clock has passed half time while the ball was already in the net
  g.ball.lastToucher = g.teams[0][4];
  g.onGoal(0);
  assert.equal(g.state, 'goal');
  runUntil(g, () => g.state === 'halftime' || g.state === 'ended', 60);
  assert.equal(g.state, 'halftime', 'the break comes after the goal celebration instead of a normal kick-off');
  assert.equal(g.score[0], 1);
  assert.equal(g.half, 1);
});

test('a shot still in the air when the first half ends is cut off by the whistle', () => {
  seedRandom(16);
  const g = makeGame();
  startCpuMatch(g, { mode: '1p', length: 60 });
  g.ctrls[0].enabled = false;
  runUntil(g, () => g.state === 'playing', 20);
  g.clock = 30.02;
  g.ball.reset(PITCH.hl - 8, 0); g.teams[1][0].saveCd = 1e9; g.ball.owner = g.teams[0][4]; g.ball.vel.set(24, 0.4, 0);
  runUntil(g, () => g.state !== 'playing', 5);
  assert.equal(g.state, 'halftime');
  assert.equal(g.score[0], 0);
});

test('half time restores some energy', () => {
  const { g } = playToHalftime(7);
  g.lineups.subs = [5, 5]; // no CPU substitutions at the restart: this test is about the energy only
  for (const p of g.all) p.energy = 0.4;
  g.endHalftime();
  for (const p of g.all) assert.ok(Math.abs(p.energy - 0.65) < 1e-9);
});

test('a watched CPU-vs-CPU match carries on from half time by itself', () => {
  seedRandom(8);
  const g = makeGame(); startCpuMatch(g, { mode: 'cpu', length: 30 });
  runUntil(g, () => g.state === 'halftime', 100);
  assert.equal(g.state, 'halftime');
  runUntil(g, () => g.half === 2, 20);
  assert.equal(g.half, 2);
  runUntil(g, () => g.state === 'ended', 200);
  assert.equal(g.state, 'ended');
});

test('each match starts in the first half with the original ends', () => {
  const { g } = playToHalftime(9);
  g.endHalftime();
  g.startMatch({ mode: 'cpu', teams: [0, 1], diff: 'normal', length: 30, knockout: false, env: { time: 'day', weather: 'clear' } });
  assert.equal(g.half, 1); assert.equal(SIDES.flip, 1);
});

test('a shoot-out after a draw works with the flipped ends', () => {
  seedRandom(10);
  const g = makeGame(); startCpuMatch(g, { mode: 'cpu', length: 20, knockout: true });
  for (let n = 0; n < 40 && g.state !== 'ended'; n++) {
    runUntil(g, () => g.state === 'ended' || g.rules.so, 100);
    if (g.rules.so) break;
  }
  runUntil(g, () => g.state === 'ended', 300);
  assert.equal(g.state, 'ended');
});

test('ball sizes follow the standard diameters and size 5 is the default radius', () => {
  assert.equal(Object.keys(BALL_SIZES).length, 5);
  assert.equal(ballRadius(5), BALL_R);
  let prev = 0;
  for (const s of [1, 2, 3, 4, 5]) { const r = ballRadius(s); assert.ok(r > prev, `size ${s}`); prev = r; }
  assert.ok(Math.abs(ballRadius(1) / ballRadius(5) - 14 / 22.5) < 1e-9);
  assert.equal(setBallSize(99), BALL_R, 'an invalid size falls back to size 5');
});

test('the ball model and physics follow the chosen size', () => {
  const b = new Ball();
  b.setSize(1);
  assert.ok(Math.abs(b.mesh.scale.x - ballRadius(1) / BALL_R) < 1e-9);
  b.pos.set(0, 4, 0);
  for (let i = 0; i < 60 * 6; i++) b.step(1 / 60);
  assert.ok(Math.abs(b.pos.y - ballRadius(1)) < 0.02, 'rests on the ground at its own radius');
  b.setSize(5);
  assert.equal(BALL.r, BALL_R);
  assert.ok(b.pos.y >= BALL_R - 1e-9, 'a ball that gets bigger is lifted out of the grass');
});

test('a small ball still scores and is still held by the goalkeeper', () => {
  for (const size of [1, 3]) {
    resetGlobals();
    seedRandom(20 + size);
    const g = makeGame(); setBallSize(size); g.ball.setSize(size);
    startCpuMatch(g, { length: 40 });
    runUntil(g, () => g.state === 'ended', 300);
    assert.equal(g.state, 'ended');
    assert.ok(Number.isFinite(g.ball.pos.x));
  }
  resetGlobals();
});

test('settings default to ball size 5 with speech on and automatic voice', () => {
  assert.equal(settings.ballSize, 5); assert.equal(settings.tts, true); assert.equal(settings.ttsVoice, '');
});
