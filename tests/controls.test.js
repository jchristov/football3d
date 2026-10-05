import test from 'node:test';
import assert from 'node:assert/strict';
import { settings, resetSettings } from '../src/settings.js';
import { SCHEMES, ACTIONS, rebind, resetBindings, keyboardKeys, RESERVED, DEFAULT_KEYS } from '../src/controls.js';
import { Input } from '../src/input.js';

test.beforeEach(() => resetBindings());

test('every scheme has keyboard, gamepad and touch sources for every action', () => {
  for (const s of Object.keys(SCHEMES).filter((k) => k !== 'net')) for (const a of ACTIONS) {
    assert.ok(SCHEMES[s][a].length >= 2, `${s}.${a}`);
    assert.ok(SCHEMES[s][a].some((c) => c.startsWith('Pad')));
  }
  for (const a of ACTIONS) assert.deepEqual(SCHEMES.net[a], [`Net:${a}`], 'the online friend is driven by virtual keys only');
  assert.ok(SCHEMES.solo.shoot.includes('Touch:shoot'));
  assert.ok(!SCHEMES.p1.shoot.includes('Touch:shoot'), 'touch only drives single player');
});

test('rebinding replaces the key and updates the live scheme object', () => {
  const live = SCHEMES.solo; // controllers keep this reference
  assert.ok(rebind('solo', 'shoot', 'KeyZ'));
  assert.deepEqual(keyboardKeys('solo', 'shoot'), ['KeyZ']);
  assert.equal(SCHEMES.solo, live);
  assert.ok(live.shoot.includes('KeyZ') && !live.shoot.includes('Space'));
});

test('binding a key that is already used moves it away from the other action', () => {
  rebind('p1', 'pass', 'KeyE'); // KeyE was tackle
  assert.deepEqual(keyboardKeys('p1', 'pass'), ['KeyE']);
  assert.ok(!keyboardKeys('p1', 'tackle').includes('KeyE'));
  assert.ok(keyboardKeys('p1', 'tackle').length >= 1, 'the other action keeps a key');
});

test('reserved global keys cannot be bound', () => {
  for (const k of RESERVED) assert.equal(rebind('solo', 'shoot', k), false);
  assert.deepEqual(keyboardKeys('solo', 'shoot'), DEFAULT_KEYS.solo.shoot);
});

test('reset restores the defaults', () => {
  rebind('solo', 'shoot', 'KeyZ');
  resetBindings('solo');
  assert.deepEqual(keyboardKeys('solo', 'shoot'), DEFAULT_KEYS.solo.shoot);
});

test('input: edges are consumed once; held keys stay down; strongest stick wins', () => {
  const i = new Input(null);
  i.setCode('Pad0:shoot', true);
  assert.ok(i.down('Pad0:shoot'));
  assert.ok(i.consume('Pad0:shoot'));
  assert.ok(!i.consume('Pad0:shoot'));
  assert.ok(i.down('Pad0:shoot'));
  i.setStick('Pad0', 0.2, 0); i.setStick('Touch', 0, -0.8);
  const s = i.stick(['Pad0', 'Touch']);
  assert.equal(s.y, -0.8);
  assert.ok(Math.abs(s.mag - 0.8) < 1e-9);
});

test('settings reset returns the defaults', () => {
  settings.master = 0.1; settings.ball = 'ink';
  resetSettings();
  assert.equal(settings.master, 0.8);
  assert.equal(settings.ball, 'classic');
});

test('no default key binding collides with a global shortcut (B, H, O ...)', () => {
  for (const k of ['KeyB', 'KeyH', 'KeyO']) assert.ok(RESERVED.has(k), k);
  for (const [scheme, acts] of Object.entries(DEFAULT_KEYS)) for (const [a, keys] of Object.entries(acts)) {
    for (const k of keys) assert.ok(!RESERVED.has(k), `${scheme}.${a} uses reserved ${k}`);
  }
});

test('every global shortcut handled by the game is documented in the shortcut list', async () => {
  const { SHORTCUTS } = await import('../src/controls.js');
  const keys = SHORTCUTS.map(([k]) => k).join(' ');
  for (const k of ['C', 'V', 'T', 'N', 'P', 'M', 'B', 'H', 'O', 'Esc', 'Enter', 'Space']) assert.ok(keys.includes(k), `${k} is documented`);
});
