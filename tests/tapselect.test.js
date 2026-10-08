import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bindTapSelect, TAP_MS, TAP_PX } from '../src/tapselect.js';
import { makeGame, startCpuMatch, runUntil, step, seedRandom, resetGlobals } from './helpers.js';

test.beforeEach(() => resetGlobals());

function fakeEl() {
  const l = {};
  return { l, addEventListener: (t, f) => { (l[t] ||= []).push(f); }, removeEventListener: (t, f) => { l[t] = (l[t] || []).filter((x) => x !== f); },
    fire(t, e) { (l[t] || []).forEach((f) => f({ pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0, ...e })); } };
}

test('a short touch that hardly moves is a tap; drags, long presses, mouse and cancelled touches are not', () => {
  const el = fakeEl(); let t = 0; const taps = [];
  bindTapSelect(el, (x, y) => taps.push([x, y]), () => t);
  const touch = (dt, dx = 0, extra = {}) => { t = 1000; el.fire('pointerdown', { clientX: 100, clientY: 50, ...extra }); t += dt; el.fire('pointerup', { clientX: 100 + dx, clientY: 50, ...extra }); };
  touch(100); assert.deepEqual(taps, [[100, 50]]);
  touch(TAP_MS + 50); assert.equal(taps.length, 1, 'a long press is not a tap');
  touch(100, TAP_PX + 10); assert.equal(taps.length, 1, 'a drag is not a tap');
  touch(100, 0, { pointerType: 'mouse' }); assert.equal(taps.length, 1, 'mouse clicks are handled by the mouse controls');
  t = 1000; el.fire('pointerdown', { clientX: 1, clientY: 1 }); el.fire('pointercancel', {}); el.fire('pointerup', { clientX: 1, clientY: 1 }); assert.equal(taps.length, 1);
  touch(80, 0, { pointerId: 7 }); assert.equal(taps.length, 2, 'each finger on its own');
});

function ready(over = {}) {
  seedRandom(5);
  const g = makeGame();
  startCpuMatch(g, { mode: '1p', length: 600, ...over });
  runUntil(g, () => g.state === 'playing', 10);
  step(g, 1);
  g.pointerRect = () => ({ left: 0, top: 0, width: 844, height: 390 });
  g.camera.aspect = 844 / 390; g.camera.updateProjectionMatrix();
  return g;
}
// where a player appears on the screen
const screenOf = (g, p) => { const v = new THREE.Vector3(p.pos.x, 0.9, p.pos.z).project(g.camera); return [(v.x * 0.5 + 0.5) * 844, (0.5 - v.y * 0.5) * 390]; };

test('tapping a team-mate on the screen gives him to the player; the automatic switching leaves him alone for a moment', () => {
  const g = ready(), c = g.ctrls[0];
  const mate = g.teams[0].find((p) => !p.isGK && p !== c.player);
  const [x, y] = screenOf(g, mate);
  assert.equal(g.selectByTouch(x + 5, y - 6), true);
  assert.equal(c.player, mate);
  // the ball is next to somebody else, but the chosen player stays selected for the lock time
  const other = g.teams[0].find((p) => !p.isGK && p !== mate);
  g.ball.owner = null; g.ball.reset(other.pos.x, other.pos.z);
  c.select(); assert.equal(c.player, mate, 'locked');
  c.lockT = 0; c.select(); assert.equal(c.player, other, 'the normal automatic selection is back');
});

test('taps that miss, hit the goalkeeper, opponents, or come at the wrong time do nothing', () => {
  const g = ready(), c = g.ctrls[0], before = c.player;
  assert.equal(g.selectByTouch(5, 5), false, 'empty sky');
  const gk = g.teams[0][0], [gx, gy] = screenOf(g, gk);
  g.selectByTouch(gx, gy); assert.ok(!c.player.isGK, 'goalkeepers are not selectable');
  const opp = g.teams[1].find((p) => !p.isGK), [ox, oy] = screenOf(g, opp);
  const mates = g.teams[0].filter((p) => !p.isGK).map((p) => screenOf(g, p));
  if (!mates.some(([mx, my]) => Math.hypot(mx - ox, my - oy) < 60)) { assert.equal(g.selectByTouch(ox, oy), false, 'an opponent'); assert.equal(c.player, before); }
  const mate = g.teams[0].find((p) => !p.isGK && p !== c.player), [mx, my] = screenOf(g, mate);
  g.modal = true; assert.equal(g.selectByTouch(mx, my), false, 'a panel is open'); g.modal = false;
  g.state = 'paused'; assert.equal(g.selectByTouch(mx, my), false, 'paused'); g.state = 'playing';
  g.remote = {}; assert.equal(g.selectByTouch(mx, my), false, 'an online guest'); g.remote = null;
});

test('the nearest player to the finger wins when players stand close together; a 2-player match is not affected', () => {
  const g = ready(), c = g.ctrls[0];
  const [a, b] = g.teams[0].filter((p) => !p.isGK && p !== c.player);
  a.pos.set(0, 0, 0); b.pos.set(1.2, 0, 0);
  const [bx, by] = screenOf(g, b);
  g.selectByTouch(bx + 2, by); assert.equal(c.player, b);
  const g2 = makeGame(); startCpuMatch(g2, { mode: '2p', length: 600 }); runUntil(g2, () => g2.state === 'playing', 10);
  g2.pointerRect = () => ({ left: 0, top: 0, width: 844, height: 390 });
  assert.equal(g2.selectByTouch(400, 200), false, 'two players share a keyboard / pads: no touch selection');
});
