import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runUntil, step, seedRandom, resetGlobals } from './helpers.js';

test.beforeEach(() => resetGlobals());

function setup() {
  seedRandom(7);
  const g = makeGame();
  g.startMatch({ mode: '1p', teams: [0, 1], diff: 'normal', length: 120, knockout: false, env: { time: 'day', weather: 'clear' } });
  runUntil(g, () => g.state === 'playing', 10); step(g, 0.3);
  for (const o of g.all) o.pos.set(o.pos.x, 0, o.pos.z + 40);
  return g;
}

test('a human can head a high ball on request, further with more charge', () => {
  const dist = [];
  for (const charge of [0.15, 1]) {
    const g = setup();
    const p = g.ctrls[0].player;
    p.place(0, 0, 0); p.headCd = 0; p.kickCd = 0; p.touchCd = 0;
    g.ball.reset(0.8, 0); g.ball.pos.y = 2.3; g.ball.vel.set(0, 0, 0); g.ball.owner = null;
    assert.ok(g.canHead(p));
    assert.ok(g.humanHeader(p, charge, 0, false), 'header played');
    assert.ok(p.jumpT > 0);
    dist.push(Math.hypot(g.ball.vel.x, g.ball.vel.z));
  }
  assert.ok(dist[1] > dist[0] + 5, `${dist}`);
});

test('no header for a ball on the ground', () => {
  const g = setup();
  const p = g.teams[0].find((x) => !x.isGK);
  p.place(0, 0, 0); p.headCd = 0;
  g.ball.reset(0.5, 0);
  assert.equal(g.humanHeader(p, 1, 0, false), false);
});

test('a dribbled ball follows a turning carrier instead of trailing behind', () => {
  const g = setup();
  const p = g.teams[0].find((x) => !x.isGK);
  p.place(-10, 0, 0); p.touchCd = 0; p.kickCd = 0;
  g.ball.reset(-9.4, 0); g.ball.owner = p;
  let worst = 0;
  for (let i = 0; i < 180; i++) {
    const a = i < 60 ? 0 : Math.PI / 2 + (i > 120 ? 1 : 0);
    for (const o of g.all) if (o !== p) { o.pos.set(30, 0, 25); o.vel.set(0, 0, 0); }
    p.facing = a; p.vel.set(Math.cos(a) * 4.5, 0, Math.sin(a) * 4.5);
    p.pos.x += p.vel.x / 60; p.pos.z += p.vel.z / 60;
    step(g, 1 / 60);
    if (g.ball.owner !== p) { const o = g.ball.owner; assert.fail(`lost at ${i}: owner ${o && o.team}/${o && o.pos.x.toFixed(1)},${o && o.pos.z.toFixed(1)} state ${g.state} ball ${g.ball.pos.x.toFixed(1)},${g.ball.pos.z.toFixed(1)},${g.ball.pos.y.toFixed(1)} p ${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)}`); }
    if (i > 70) worst = Math.max(worst, Math.hypot(g.ball.pos.x - p.pos.x, g.ball.pos.z - p.pos.z));
  }
  assert.ok(g.ball.owner === p, "owner lost");
  assert.ok(worst < 1.6, `ball strayed ${worst.toFixed(2)} m`);
});

test('a tap shot is much weaker than a charged one', () => {
  const sp = [];
  for (const c of [0.12, 1]) {
    const g = setup();
    const p = g.teams[0].find((x) => !x.isGK);
    p.place(-10, 0, 0); p.kickCd = 0; p.touchCd = 0;
    g.ball.reset(-9.5, 0); g.ball.owner = p;
    g.humanShoot(p, c);
    sp.push(g.ball.speed);
  }
  assert.ok(sp[1] > sp[0] * 2, `${sp}`);
});
