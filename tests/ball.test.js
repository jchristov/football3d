import test from 'node:test';
import assert from 'node:assert/strict';
import { Ball } from '../src/ball.js';
import { PITCH, GOAL, BALL_R } from '../src/constants.js';
import { resetGlobals } from './helpers.js';

test.beforeEach(() => resetGlobals());

const run = (ball, seconds) => { for (let i = 0; i < seconds * 60; i++) ball.step(1 / 60); };

test('a dropped ball bounces lower each time and comes to rest', () => {
  const b = new Ball();
  b.pos.set(0, 5, 0);
  let maxAfterFirst = 0, bounced = false;
  for (let i = 0; i < 60 * 8; i++) {
    b.step(1 / 60);
    if (b.pos.y <= BALL_R + 0.01) bounced = true;
    else if (bounced) maxAfterFirst = Math.max(maxAfterFirst, b.pos.y);
  }
  assert.ok(maxAfterFirst > 0.5 && maxAfterFirst < 5, 'rebounds, but lower than the drop height');
  assert.ok(Math.abs(b.pos.y - BALL_R) < 0.02, 'rests on the ground');
});

test('rolling friction slows the ball, and weather changes how fast', () => {
  const dry = new Ball(), wet = new Ball();
  wet.roll = 0.78; // rain: ball runs on
  for (const b of [dry, wet]) b.vel.set(10, 0, 0);
  run(dry, 2); run(wet, 2);
  assert.ok(dry.vel.x < 10 && dry.vel.x > 0);
  assert.ok(wet.vel.x > dry.vel.x, 'less friction in the rain');
  const snow = new Ball(); snow.roll = 1.45; snow.vel.set(10, 0, 0); run(snow, 2);
  assert.ok(snow.vel.x < dry.vel.x, 'more drag in the snow');
});

test('the ball cannot leave the pitch sideways (boards)', () => {
  const b = new Ball();
  b.pos.set(0, BALL_R, 0);
  b.vel.set(0, 0, 25);
  run(b, 3);
  assert.ok(Math.abs(b.pos.z) <= PITCH.hw);
});

test('a ball driven into the goal mouth ends up in the net', () => {
  const b = new Ball();
  b.pos.set(PITCH.hl - 3, BALL_R + 0.3, 0);
  b.vel.set(20, 0, 0);
  run(b, 0.5);
  assert.notEqual(b.netSide, 0);
  assert.ok(b.pos.x > PITCH.hl);
});

test('hitting the post keeps the ball out and reports it', () => {
  const b = new Ball();
  const events = [];
  b.onEvent = (t) => events.push(t);
  b.pos.set(PITCH.hl - 4, BALL_R + 0.5, GOAL.hw);
  b.vel.set(18, 0, 0);
  run(b, 0.6);
  assert.ok(events.includes('post'));
  assert.equal(b.netSide, 0);
});

test('spin curves the ball while it flies, and decays on the ground', () => {
  const b = new Ball();
  b.pos.set(0, 1, 0);
  b.vel.set(15, 3, 0);
  b.spin = 0.7;
  run(b, 0.8);
  assert.ok(Math.abs(b.pos.z) > 0.5, 'path bends sideways');
  assert.ok(Math.abs(b.spin) < 0.7);
});

test('a kick sets velocity and owner', () => {
  const b = new Ball();
  const who = { team: 0 };
  b.kick(who, 0, 20, 3, 0.2);
  assert.equal(b.vel.x, 20);
  assert.equal(b.vel.y, 3);
  assert.equal(b.owner, who);
  assert.equal(b.spin, 0.2);
});
