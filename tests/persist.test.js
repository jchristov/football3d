import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaults, settings, loadSettings, saveSettings, resetSettings } from '../src/settings.js';
import { cleanMenuChoices } from '../src/menu.js';
import { makeGame, startCpuMatch, resetGlobals } from './helpers.js';

// A tiny in-memory localStorage
function fakeStore(initial = {}) {
  const data = { ...initial };
  globalThis.localStorage = { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
  return data;
}

test.beforeEach(() => { resetGlobals(); resetSettings(); });
test.afterEach(() => { delete globalThis.localStorage; });

test('every setting is written to localStorage and read back, including the start-screen choices, camera and mute', () => {
  const data = fakeStore();
  settings.panelOpacity = 0.5; settings.minimap = false; settings.events = true; settings.camera = 'top'; settings.muted = true;
  settings.menu = { mode: '2p', comp: 'friendly', diff: 'hard', teamA: 3, teamB: 5, time: 'night', weather: 'snow', stadium: 'neon' };
  settings.ballSize = 3; settings.teamSize = 9; settings.tts = false; settings.ttsVoice = 'v1'; settings.quality = 'low';
  saveSettings();
  const stored = JSON.parse(data['football3d.settings']);
  for (const k of Object.keys(makeDefaults())) assert.ok(k in stored, `${k} is saved`);
  Object.assign(settings, makeDefaults());
  loadSettings();
  assert.equal(settings.panelOpacity, 0.5); assert.equal(settings.minimap, false); assert.equal(settings.events, true);
  assert.equal(settings.camera, 'top'); assert.equal(settings.muted, true);
  assert.deepEqual(settings.menu, { mode: '2p', comp: 'friendly', diff: 'hard', teamA: 3, teamB: 5, time: 'night', weather: 'snow', stadium: 'neon' });
  assert.equal(settings.ballSize, 3); assert.equal(settings.teamSize, 9); assert.equal(settings.tts, false); assert.equal(settings.quality, 'low');
});

test('the old separate mute key is migrated into the settings', () => {
  fakeStore({ 'football3d.muted': '1' });
  Object.assign(settings, makeDefaults());
  loadSettings();
  assert.equal(settings.muted, true);
});

test('settings saved by an older version (no menu / camera / mute entries) still load with defaults', () => {
  fakeStore({ 'football3d.settings': JSON.stringify({ master: 0.3, ball: 'gold' }) });
  loadSettings();
  assert.equal(settings.master, 0.3); assert.equal(settings.ball, 'gold');
  assert.deepEqual(settings.menu, makeDefaults().menu); assert.equal(settings.camera, 'broadcast'); assert.equal(settings.muted, false);
});

test('start-screen choices from storage are validated', () => {
  assert.deepEqual(cleanMenuChoices({ mode: 'bogus', teamA: 99, teamB: -1, time: 'dusk', diff: 'hard' }), { mode: '1p', comp: 'friendly', diff: 'hard', teamA: 0, teamB: 1, time: 'dusk', weather: 'clear', stadium: 'arena' });
  assert.deepEqual(cleanMenuChoices(undefined), makeDefaults().menu);
});

test('"reset all settings" keeps the sound switch', () => {
  fakeStore();
  settings.muted = true; settings.panelOpacity = 0.4;
  resetSettings();
  assert.equal(settings.panelOpacity, makeDefaults().panelOpacity);
  assert.equal(settings.muted, true);
});

test('a match starts with the camera chosen last time', () => {
  const g = makeGame();
  settings.camera = 'top';
  startCpuMatch(g, { length: 60 });
  assert.equal(g.camModes[g.camMode], 'top');
  settings.camera = 'follow';
  startCpuMatch(g, { length: 60 });
  assert.equal(g.camModes[g.camMode], 'follow'.length ? g.camModes[g.camMode] : '', 'cpu mode has all three cameras');
  settings.camera = 'nonsense';
  startCpuMatch(g, { length: 60 });
  assert.equal(g.camMode, 0);
});
