import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { FpsGovernor, NEXT_LOWER } from '../src/perf.js';
import { makeDefaults } from '../src/settings.js';
import { RESERVED, SHORTCUTS } from '../src/controls.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const pub = (f) => path.join(ROOT, 'public', f);

test('the manifest describes an installable landscape game with icons that exist', () => {
  const m = JSON.parse(fs.readFileSync(pub('manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone'); assert.equal(m.start_url, './'); assert.ok(m.name && m.short_name);
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) {
    const file = fs.readFileSync(pub(i.src));
    assert.equal(file.subarray(1, 4).toString(), 'PNG', i.src);
    const [w, h] = [file.readUInt32BE(16), file.readUInt32BE(20)];
    assert.equal(`${w}x${h}`, i.sizes, `${i.src} has the declared size`);
  }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /rel="manifest"/); assert.match(html, /name="theme-color"/);
});

function loadWorker() {
  const listeners = {};
  const self = { location: { origin: 'https://game.example' }, addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting() {}, clients: { claim() {} } };
  vm.runInNewContext(fs.readFileSync(pub('sw.js'), 'utf8'), { self, URL, Promise, caches: {}, fetch() {} });
  return { self, listeners };
}
const req = (url, { method = 'GET', mode = 'cors', range = null } = {}) => ({ url, method, mode, headers: { get: (h) => (h.toLowerCase() === 'range' ? range : null) } });

test('the service worker caches the game files, but not other sites, uploads, partial requests or itself', () => {
  const { self, listeners } = loadWorker();
  assert.ok(listeners.install && listeners.activate && listeners.fetch);
  const r = (q) => self.fb3dRoute(q, 'https://game.example');
  assert.equal(r(req('https://game.example/assets/index-abc.js')), 'asset');
  assert.equal(r(req('https://game.example/audio/bed.mp3')), 'asset');
  assert.equal(r(req('https://game.example/', { mode: 'navigate' })), 'navigate');
  assert.equal(r(req('https://fonts.example/font.woff2')), 'ignore');
  assert.equal(r(req('https://game.example/api', { method: 'POST' })), 'ignore');
  assert.equal(r(req('https://game.example/audio/bed.mp3', { range: 'bytes=0-1' })), 'ignore');
  assert.equal(r(req('https://game.example/sw.js')), 'ignore');
});

test('every audio file of the game is in the precache list', () => {
  const code = fs.readFileSync(pub('sw.js'), 'utf8');
  for (const f of fs.readdirSync(pub('audio'))) assert.ok(code.includes(`./audio/${f}`), `${f} is precached`);
});

test('the frame-rate watchdog lowers quality only after several slow seconds in a row', () => {
  const g = new FpsGovernor();
  const run = (seconds, fps) => { let advised = false; for (let i = 0; i < seconds * fps; i++) if (g.update(1 / fps)) advised = true; return advised; };
  assert.equal(run(30, 60), false, 'a healthy 60 fps never triggers');
  assert.equal(run(3, 20), false, 'the warm-up and the first slow window are tolerated');
  assert.equal(run(10, 20), true, 'ten slow seconds trigger it');
});

test('short dips, stalls and inactive frames do not count', () => {
  const g = new FpsGovernor();
  for (let i = 0; i < 60 * 6; i++) g.update(1 / 60);
  let advised = false;
  for (let k = 0; k < 6; k++) { for (let i = 0; i < 40; i++) advised ||= g.update(1 / 20); for (let i = 0; i < 300; i++) advised ||= g.update(1 / 60); } // one slow window, then recovery
  assert.equal(advised, false, 'a single slow window followed by good ones is ignored');
  for (let i = 0; i < 10; i++) advised ||= g.update(2); // tab switch stalls
  for (let i = 0; i < 2000; i++) advised ||= g.update(1 / 10, false); // paused game
  assert.equal(advised, false);
});

test('quality steps down one level at a time and stops at low; the option is on by default', () => {
  assert.equal(NEXT_LOWER.high, 'medium'); assert.equal(NEXT_LOWER.medium, 'low'); assert.equal(NEXT_LOWER.low, null);
  assert.equal(makeDefaults().autoQuality, true);
});

test('X (full screen) is reserved and documented', () => {
  assert.ok(RESERVED.has('KeyX'));
  assert.ok(SHORTCUTS.some(([k]) => k === 'X'));
});
