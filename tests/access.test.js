import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaults, clampUiScale, motionReduced } from '../src/settings.js';

test('accessibility settings default to the normal look and the system motion preference', () => {
  const d = makeDefaults();
  assert.equal(d.colorBlind, false); assert.equal(d.uiScale, 1); assert.equal(d.reducedMotion, null);
});

test('the UI size stays between 80% and 150%', () => {
  assert.equal(clampUiScale(1), 1); assert.equal(clampUiScale(0.2), 0.8); assert.equal(clampUiScale(9), 1.5);
  assert.equal(clampUiScale('abc'), 1); assert.equal(clampUiScale(undefined), 1);
});

test('reduced motion follows the system unless the player chose', () => {
  assert.equal(motionReduced({ reducedMotion: null }, true), true);
  assert.equal(motionReduced({ reducedMotion: null }, false), false);
  assert.equal(motionReduced({ reducedMotion: false }, true), false, 'the player turned it off');
  assert.equal(motionReduced({ reducedMotion: true }, false), true, 'the player turned it on');
  assert.equal(motionReduced({}, true), true);
});
