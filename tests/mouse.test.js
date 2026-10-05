import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bindMouse, mouseActive, screenToGround, MOUSE_IDLE } from '../src/mouse.js';
import { Input } from '../src/input.js';
import { SCHEMES } from '../src/controls.js';
import { settings } from '../src/settings.js';
import { makeGame, startCpuMatch, runUntil, step, seedRandom, resetGlobals } from './helpers.js';

test.beforeEach(() => { resetGlobals(); settings.mouse = true; });

// a stand-in for the canvas that records its listeners
function fakeCanvas() {
  const l = {};
  return { l, addEventListener: (t, f) => { (l[t] ||= []).push(f); }, removeEventListener: (t, f) => { l[t] = (l[t] || []).filter((x) => x !== f); },
    fire(t, e = {}) { const ev = { pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, deltaY: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...e }; (l[t] || []).forEach((f) => f(ev)); return ev; } };
}

test('the buttons of the mouse become virtual keys; the wheel switches players once per flick', () => {
  const input = new Input(null), c = fakeCanvas();
  let t = 100; bindMouse(input, c, () => t);
  c.fire('pointerdown', { button: 0 }); assert.ok(input.down('Mouse:shoot'));
  c.fire('pointerdown', { button: 2 }); assert.ok(input.down('Mouse:pass'));
  c.fire('pointerdown', { button: 1 }); assert.ok(input.consume('Mouse:tackle'), 'a press is an edge');
  c.fire('pointerup', { button: 0 }); assert.ok(!input.down('Mouse:shoot'));
  c.fire('wheel', { deltaY: 120 }); assert.ok(input.consume('Mouse:swap'));
  c.fire('wheel', { deltaY: 120 }); assert.ok(!input.consume('Mouse:swap'), 'the same flick counts once');
  t += 0.3; c.fire('wheel', { deltaY: -120 }); assert.ok(input.consume('Mouse:swap'));
  assert.equal(c.fire('contextmenu').defaultPrevented, true, 'no browser menu on right click');
});

test('touch and disabled mouse are ignored; leaving the canvas releases everything', () => {
  const input = new Input(null), c = fakeCanvas();
  bindMouse(input, c, () => 1);
  c.fire('pointerdown', { pointerType: 'touch', button: 0 });
  assert.ok(!input.down('Mouse:shoot'), 'the touch controls handle touches');
  c.fire('pointerdown', { button: 0 }); c.fire('pointerdown', { button: 2 });
  c.fire('pointerleave');
  assert.ok(!input.down('Mouse:shoot', 'Mouse:pass'));
  input.mouse.enabled = false;
  c.fire('pointerdown', { button: 0 });
  assert.ok(!input.down('Mouse:shoot'));
});

test('the pointer steers while it moves, a button is held, and for a few seconds after', () => {
  const input = new Input(null), c = fakeCanvas();
  let t = 10; bindMouse(input, c, () => t);
  assert.equal(mouseActive(input.mouse, t), false, 'not before it has moved');
  c.fire('pointermove', { clientX: 5, clientY: 5 });
  assert.equal(mouseActive(input.mouse, t + 1), true);
  assert.equal(mouseActive(input.mouse, t + MOUSE_IDLE + 1), false, 'idle: the keyboard is in charge again');
  c.fire('pointerdown', { button: 0 });
  assert.equal(mouseActive(input.mouse, t + 100), true, 'a held button keeps it active');
  c.fire('pointerleave');
  assert.equal(mouseActive(input.mouse, t + 1), false, 'outside the canvas');
});

test('a point of the screen is mapped to the pitch', () => {
  const cam = new THREE.PerspectiveCamera(45, 1.6, 0.5, 400);
  cam.position.set(0, 12, 20); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const mid = screenToGround(cam, 0, 0);
  assert.ok(Math.abs(mid.x) < 0.01 && Math.abs(mid.z) < 0.01, 'the centre of the screen is where the camera looks');
  const right = screenToGround(cam, 0.5, 0), up = screenToGround(cam, 0, 0.5);
  assert.ok(right.x > 3, 'right of the centre'); assert.ok(up.z < -3, 'higher on the screen = further away');
  cam.position.set(0, 2, 20); cam.lookAt(0, 2, 0); cam.updateMatrixWorld();
  assert.equal(screenToGround(cam, 0, 0.8), null, 'the sky is not the pitch');
});

function mouseGame(seed = 5) {
  seedRandom(seed);
  const g = makeGame();
  startCpuMatch(g, { mode: '1p', length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  step(g, 1);
  g.input.mouse = { enabled: true, inside: true, last: 0, buttons: new Set(), x: 0, y: 0 };
  g.mouseOn = true;
  return g;
}

test('without keys the player runs towards the pointer, slows down on arrival and uses the keyboard when it is pressed', () => {
  const g = mouseGame(), c = g.ctrls[0], p = c.player;
  p.pos.set(-5, 0, 0);
  g.mouseGround = { x: 10, z: 6 };
  let v = c.moveVector();
  assert.ok(v.mouse && v.l > 0.9 && v.dx > 0 && v.dz > 0, JSON.stringify(v));
  g.mouseGround = { x: -5.5, z: 0.3 };
  assert.equal(c.moveVector().l, 0, 'on the spot: stand still');
  g.mouseGround = { x: -4, z: 0 };
  v = c.moveVector(); assert.ok(v.l > 0 && v.l < 0.7, 'slows down near the pointer');
  g.mouseGround = { x: 10, z: 6 };
  g.input.setCode(SCHEMES.solo.left[0], true);
  v = c.moveVector();
  assert.ok(!v.mouse && v.l > 0, 'a held key wins over the pointer');
  g.input.setCode(SCHEMES.solo.left[0], false);
});

test('the setting, the pointer state and the controller type decide whether the mouse is used', () => {
  const g = mouseGame(), c = g.ctrls[0];
  c.player.pos.set(0, 0, 0); g.mouseGround = { x: 8, z: 0 };
  assert.ok(c.moveVector().mouse);
  settings.mouse = false; assert.equal(c.moveVector().l, 0); settings.mouse = true;
  g.mouseOn = false; assert.equal(c.moveVector().l, 0); g.mouseOn = true;
  g.mouseGround = null; assert.equal(c.moveVector().l, 0);
  g.mouseGround = { x: 8, z: 0 };
  const p1 = new c.constructor(g, 0, 'p1'); p1.player = c.player;
  assert.equal(p1.moveVector().l, 0, 'the two-player scheme is keyboard only');
});

test('shots and passes go towards the pointer; a far pointer sprints', () => {
  const g = mouseGame(), c = g.ctrls[0], p = c.player;
  p.pos.set(0, 0, 0); p.stamina = 1; p.facing = Math.PI; // facing the wrong way
  g.mouseGround = { x: 12, z: 0 };
  assert.ok(Math.abs(c.mouseAim()) < 1e-6, 'aim along +x');
  g.mouseGround = { x: 0.5, z: 0.2 };
  assert.equal(c.mouseAim(), null, 'pointer on the player: no aim');
  g.mouseGround = { x: 30, z: 0 };
  const before = p.stamina; g.ball.reset(8, 8);
  for (let i = 0; i < 60; i++) c.update(1 / 60);
  assert.ok(p.stamina < before, 'sprinting to a far pointer costs stamina');
  // shooting: held left button charges, release kicks at the pointer
  g.ball.reset(p.pos.x + 0.5, p.pos.z); g.ball.owner = p; p.kickCd = 0; p.stunT = 0; p.lungeT = 0;
  g.mouseGround = { x: p.pos.x + 15, z: p.pos.z + 5 };
  g.input.setCode('Mouse:shoot', true);
  for (let i = 0; i < 40; i++) { g.ball.pos.set(p.pos.x + 0.5, 0.3, p.pos.z); c.update(1 / 60); }
  g.input.setCode('Mouse:shoot', false);
  g.ball.pos.set(p.pos.x + 0.5, 0.3, p.pos.z);
  c.update(1 / 60);
  assert.ok(g.ball.vel.x > 3 && g.ball.vel.z > 0.3, `towards the pointer: ${g.ball.vel.x}, ${g.ball.vel.z}`);
});

test('the solo scheme has the mouse as an input source, the online friend does not', () => {
  assert.ok(SCHEMES.solo.shoot.includes('Mouse:shoot') && SCHEMES.solo.pass.includes('Mouse:pass'));
  assert.ok(SCHEMES.solo.tackle.includes('Mouse:tackle') && SCHEMES.solo.swap.includes('Mouse:swap'));
  assert.ok(!SCHEMES.p1.shoot.some((c) => c.startsWith('Mouse')));
});
