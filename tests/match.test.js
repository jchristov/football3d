import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runUntil, step, startCpuMatch, seedRandom, resetGlobals } from './helpers.js';
import { Stats } from '../src/stats.js';
import { PITCH, GOAL } from '../src/constants.js';
import * as THREE from 'three';
import { FATIGUE_MIN } from '../src/player.js';

test('a full CPU match finishes, scores are consistent and nothing goes NaN', () => {
  seedRandom(1);
  const g = makeGame();
  startCpuMatch(g, { length: 90 });
  runUntil(g, () => g.state === 'ended');
  assert.equal(g.state, 'ended');
  assert.equal(g.stats.goals.length, g.score[0] + g.score[1], 'every goal is logged');
  for (const p of g.all) assert.ok(Number.isFinite(p.pos.x + p.pos.z + p.energy + p.stamina));
  assert.ok(Number.isFinite(g.ball.pos.x + g.ball.pos.y + g.ball.pos.z));
  const possession = g.stats.possession();
  assert.equal(possession[0] + possession[1], 100);
});

test('the same seed gives the same match (deterministic simulation)', () => {
  const play = () => { seedRandom(42); const g = makeGame(); startCpuMatch(g, { length: 60 }); runUntil(g, () => g.state === 'ended'); return [g.score.join('-'), g.stats.shots.join('-'), g.stats.passes.join('-')].join('|'); };
  assert.equal(play(), play());
});

test('several seeds: no stalls (ball never dead for long) and players stay on the pitch', () => {
  for (const seed of [3, 4, 5]) {
    seedRandom(seed);
    const g = makeGame();
    startCpuMatch(g, { length: 60 });
    let still = 0, worst = 0;
    while (g.state !== 'ended') {
      g.update(1 / 60);
      if (g.state === 'replay') g.endReplay();
      still = g.state === 'playing' && g.ball.speed < 0.2 && !g.ball.held ? still + 1 / 60 : 0;
      worst = Math.max(worst, still);
      for (const p of g.all) assert.ok(Math.abs(p.pos.x) <= PITCH.hl && Math.abs(p.pos.z) <= PITCH.hw);
    }
    assert.ok(worst < 6, `seed ${seed}: ball dead for ${worst.toFixed(1)}s`);
  }
});

test('a goal updates the score, banner state and records a replay clip', () => {
  seedRandom(5);
  const g = makeGame();
  startCpuMatch(g, { length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  g.rules.reset();
  g.resetKickoff(0);
  runUntil(g, () => g.state === 'playing', 10); // clean restart: no foul or set piece in progress
  g.ball.reset(PITCH.hl - 3, 0);
  g.ball.owner = g.teams[0][4]; g.ball.lastToucher = g.teams[0][4];
  g.teams[1][0].saveCd = 1e9; // keeper can't save: this tests the goal handling, not the AI
  g.ball.vel.set(24, 0.5, 0);
  step(g, 1.0);
  assert.equal(g.score[0], 1);
  assert.equal(g.stats.goals.length, 1);
  assert.equal(g.stats.goals[0].team, 0);
  assert.ok(['goal', 'replay'].includes(g.state));
  step(g, 3);
  const goal = g.stats.goals[0];
  assert.ok(goal.clip && goal.clip.frames > 20, 'goal clip stored');
  assert.equal(g.bestGoal, null, 'best goal only chosen at full time');
});

test('goal of the match: highest rating among clips wins, own goals excluded', () => {
  const g = makeGame();
  g.stats.goals = [
    { team: 0, name: 'A', minute: 5, rating: 3, clip: {}, own: false },
    { team: 1, name: 'B', minute: 20, rating: 9, clip: {}, own: false },
    { team: 0, name: 'C', minute: 30, rating: 99, clip: {}, own: true },
    { team: 1, name: 'D', minute: 40, rating: 50, clip: null, own: false },
  ];
  assert.equal(g.pickBestGoal().name, 'B');
  g.stats.goals = [];
  assert.equal(g.pickBestGoal(), null);
});

test('replay clips copy frames out of the ring buffer and play back', () => {
  seedRandom(6);
  const g = makeGame();
  startCpuMatch(g, { length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  step(g, 8);
  assert.ok(g.replay.play(g.replay.now - 5, g.replay.now, 0.7));
  const clip = g.replay.extract();
  assert.ok(clip && clip.frames >= 100);
  g.replay.stop();
  step(g, 10); // the ring buffer moves on; the clip must stay intact
  assert.ok(g.replay.playClip(clip, 1));
  let frames = 0;
  while (g.replay.step(1 / 60)) frames++;
  assert.ok(frames > 100 && frames < 400);
  assert.ok(Number.isFinite(g.ball.mesh.position.x));
});

test('fouls: a foul inside the box is a penalty, outside a free kick', () => {
  seedRandom(9);
  const g = makeGame();
  startCpuMatch(g, { length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  step(g, 2);
  const [victim, fouler] = [g.teams[0][2], g.teams[1][2]];
  victim.pos.set(10, 0, 3);
  g.rules.foul(fouler, victim);
  assert.equal(g.state, 'foul');
  assert.equal(g.rules.pending.type, 'free');
  assert.equal(g.rules.pending.team, 0);
  step(g, 3);
  assert.equal(g.state, 'setpiece');
  assert.equal(g.rules.sp.type, 'free');

  const g2 = makeGame(); startCpuMatch(g2, { length: 600 }); runUntil(g2, () => g2.state === 'playing', 10); step(g2, 2);
  g2.rules.varVerdict = () => null; // no random VAR overturn here
  g2.state = 'playing'; // the CPU play may have stopped the game for a restart meanwhile
  const v2 = g2.teams[0][2]; v2.pos.set(PITCH.hl - 3, 0, 2); // inside team 1's penalty area
  g2.rules.foul(g2.teams[1][2], v2);
  assert.equal(g2.rules.pending.type, 'penalty');
});

test('penalty shoot-out: the AI side takes kicks, a winner is declared, match ends', () => {
  seedRandom(9);
  const g = makeGame();
  startCpuMatch(g, { length: 5, knockout: true });
  runUntil(g, () => g.rules.so || g.state === 'ended', 60);
  if (!g.rules.so && g.state === 'ended') return; // decided in normal time with this seed
  runUntil(g, () => g.state === 'ended', 300);
  assert.equal(g.state, 'ended');
  assert.ok(g.result.pens, 'shoot-out recorded');
  assert.notEqual(g.result.pens[0], g.result.pens[1]);
  assert.ok(g.result.winner === 0 || g.result.winner === 1);
});

test('statistics: shots on target, pass accuracy and possession maths', () => {
  resetGlobals();
  const s = new Stats();
  const p = { team: 0, pos: { x: 15, z: 0 } };
  assert.deepEqual(s.shot(p, 0, 20) && { on: s.onTarget[0], shots: s.shots[0] }, { on: 1, shots: 1 });
  assert.ok(s.shot(p, 0.5, 20), 'a near miss counts as a shot');
  assert.equal(s.onTarget[0], 1, 'but not as one on target');
  assert.equal(s.shot(p, Math.PI / 4, 20), null, 'a wild effort is ignored');
  assert.equal(s.shots[0], 2);
  assert.equal(s.shot(p, Math.PI, 20), null, 'backwards kick is not a shot');
  const a = { team: 0 }, b = { team: 0 }, c = { team: 1 };
  s.pass(a); s.touch(b);
  s.pass(a); s.touch(c);
  assert.deepEqual([s.passes[0], s.passesOk[0]], [2, 1]);
  s.tick(0, 3); s.tick(1, 1);
  assert.deepEqual(s.possession(), [75, 25]);
  const rows = s.rows([1, 2]);
  assert.equal(rows[0][1], '75%');
  assert.equal(rows.at(-1)[1], 1);
});

test('stamina: sprinting drains the tank and match energy; resting restores them', () => {
  const g = makeGame();
  startCpuMatch(g);
  const p = g.teams[0][2];
  p.place(0, 0, 0);
  for (let i = 0; i < 60 * 4; i++) p.move(1, 0, true, 1 / 60);
  assert.ok(p.stamina < 0.1, 'sprint tank nearly empty');
  assert.ok(p.energy < 1);
  p.energy = 0.2; p.stamina = 0.1;
  for (let i = 0; i < 60 * 10; i++) p.rest(1 / 60);
  assert.ok(p.energy > 0.2 && p.stamina > 0.9);
});

test('fatigue slows a drained player but never below the floor', () => {
  const g = makeGame();
  startCpuMatch(g);
  const speedOf = (energy) => { const p = g.teams[0][2]; p.place(0, 0, 0); p.energy = energy; p.stamina = 0; for (let i = 0; i < 120; i++) { p.energy = energy; p.move(1, 0, false, 1 / 60); } return p.speed; };
  const fresh = speedOf(1), drained = speedOf(0);
  assert.ok(drained < fresh);
  assert.ok(drained >= fresh * FATIGUE_MIN - 0.05);
});

test('weather grip: rain and snow make players accelerate more slowly', () => {
  const g = makeGame();
  startCpuMatch(g);
  const accel = (grip) => { const p = g.teams[0][2]; p.place(0, 0, 0); p.grip = grip; for (let i = 0; i < 6; i++) p.move(1, 0, false, 1 / 60); return p.speed; };
  assert.ok(accel(0.72) < accel(0.82) && accel(0.82) < accel(1));
});

test('goalkeepers stay in their own penalty area during open play', () => {
  seedRandom(10);
  const g = makeGame();
  startCpuMatch(g, { length: 40 });
  let outside = 0;
  while (g.state !== 'ended') {
    g.update(1 / 60); if (g.state === 'replay') g.endReplay();
    for (const gk of [g.teams[0][0], g.teams[1][0]]) if (Math.abs(gk.pos.x) < PITCH.hl - 14 || Math.abs(gk.pos.z) > GOAL.hw + 6) outside++;
  }
  assert.ok(outside < 60 * 5, `keepers wandered for ${outside} frames`);
});

test('a ball held by the goalkeeper stays between his hands (never hangs in the air in front of him)', () => {
  let catches = 0, worst = 0;
  const tmp = [new THREE.Vector3(), new THREE.Vector3()];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    seedRandom(seed);
    const g = makeGame();
    startCpuMatch(g, { length: 60 });
    let prev = null, since = 0;
    while (g.state !== 'ended') {
      g.update(1 / 60);
      if (g.state === 'replay') g.endReplay();
      const b = g.ball;
      if (b.held) {
        if (b.held !== prev) { catches++; since = 0; }
        since++;
        if (since > 9) { // the first frames of a catch (esp. a diving one) draw the ball in
          const k = b.held;
          const mid = k.hands[0].getWorldPosition(tmp[0]).add(k.hands[1].getWorldPosition(tmp[1])).multiplyScalar(0.5);
          worst = Math.max(worst, mid.distanceTo(b.mesh.position));
        }
      }
      prev = b.held;
    }
  }
  assert.ok(catches >= 5, `only ${catches} catches were made`);
  assert.ok(worst < 0.45, `held ball drifted ${worst.toFixed(2)} m from the hands`);
});

test('the goalkeeper "holding" pose puts both hands in front of the chest, either side of the ball', () => {
  const g = makeGame();
  startCpuMatch(g);
  const k = g.teams[0][0];
  k.place(-24, 0, 0);
  k.holding = true;
  for (let i = 0; i < 40; i++) k.syncMesh(1 / 60, 0);
  const l = k.hands[0].getWorldPosition(new THREE.Vector3()), r = k.hands[1].getWorldPosition(new THREE.Vector3());
  const forward = (l.x + r.x) / 2 - k.pos.x;
  assert.ok(forward > 0.25 && forward < 0.6, `hands ${forward.toFixed(2)} m in front`);
  assert.ok(Math.abs(l.z - r.z) > 0.3 && Math.abs(l.z - r.z) < 0.7, 'hands either side of the ball');
  assert.ok((l.y + r.y) / 2 > 1.0 && (l.y + r.y) / 2 < 1.5, 'at chest height');
});
