import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { keyboardless, phoneFactor, panelZoom } from '../src/device.js';
import { RUN_AT } from '../src/touch.js';
import { makeGame, startCpuMatch, runUntil, step, seedRandom, resetGlobals } from './helpers.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
test.beforeEach(() => resetGlobals());

test('phones and tablets are keyboard-less: no hover and a coarse pointer, or ?touch=1', () => {
  const win = (search, mm) => { globalThis.window = { location: { search }, matchMedia: (q) => ({ matches: mm(q) }) }; };
  win('', (q) => q === '(hover: none) and (pointer: coarse)'); assert.equal(keyboardless(), true);
  win('', () => false); assert.equal(keyboardless(), false, 'a computer');
  win('?touch=1', () => false); assert.equal(keyboardless(), true, 'forced for testing');
  delete globalThis.window;
});

test('the widgets and panels shrink on a short screen, within limits', () => {
  assert.ok(phoneFactor(390) < 0.7 && phoneFactor(390) >= 0.55); assert.equal(phoneFactor(900), 1); assert.equal(phoneFactor(100), 0.55);
  assert.ok(panelZoom(390) < 0.8 && panelZoom(390) >= 0.68); assert.equal(panelZoom(1200), 0.88); assert.equal(panelZoom(100), 0.68);
});

test('keyboard hints are marked kb-only so that phones do not show them', () => {
  const files = ['index.html', 'src/lineupui.js', 'src/helpui.js'];
  for (const f of files) {
    for (const m of read(f).matchAll(/<small(?![^>]*kb-only)[^>]*>\s*\((?:Enter|U|P|H|Esc)\)\s*<\/small>/g)) assert.fail(`${f}: ${m[0]}`);
  }
  const html = read('index.html');
  assert.match(html, /<table class="keys kb-only">/);
  assert.match(html, /data-mode="2p" class="kb-only"/);
  assert.match(html, /id="pauseResume"/, 'a way to resume without the P key');
  assert.match(html, /id="replaySkip" class="touch-only"/, 'a way to skip a replay without Space');
});

test('the key bindings and shortcut lists of the settings are hidden on a phone', () => {
  const s = read('src/settings-ui.js');
  assert.match(s, /<div class="kb-only">\s*<h3>Controls<\/h3>/);
  assert.match(s, /class="set-opts kb-only"[^>]*><label><input type="checkbox" id="setMouse"/);
  assert.match(s, /touchScale/);
});

test('pushing the touch stick to its edge sprints; a half push only runs', () => {
  seedRandom(5);
  const g = makeGame();
  startCpuMatch(g, { mode: '1p', length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  step(g, 1);
  const c = g.ctrls[0], p = c.player;
  const run = (mag) => { // only this controller runs, so nobody tackles or takes over
    p.place(-10, 0, 0); p.stamina = 1; p.energy = 1;
    g.ball.reset(-14, 0);
    g.input.setStick('Touch', mag, 0);
    for (let i = 0; i < 60; i++) { p.tick(1 / 60); c.update(1 / 60); }
    const s = p.speed, st = p.stamina; g.input.setStick('Touch', 0, 0); return { s, st };
  };
  const walk = run(0.5), half = run(0.8), edge = run(RUN_AT + 0.05);
  assert.ok(half.s > walk.s, 'the stick is analog');
  assert.ok(edge.s > half.s * 1.15, `sprint ${edge.s} vs ${half.s}`);
  assert.ok(edge.st < 1, 'sprinting costs stamina');
  assert.equal(half.st, 1, 'running does not');
});

test('the touch buttons have no sprint button any more and fit the corner', () => {
  const t = read('src/touch.js');
  assert.doesNotMatch(t, /action: 'sprint'/);
  for (const a of ['shoot', 'pass', 'tackle', 'swap', 'curl']) assert.match(t, new RegExp(`action: '${a}'`));
  assert.match(read('src/style.css'), /--tbu: calc\(clamp\(34px, 9\.5vh, 46px\)/);
});

test('the autopilot badge sits at the right edge and steps aside during a replay', () => {
  const css = read('src/style.css');
  assert.match(css, /#autoBadge \{ left: auto; right: 14px;/);
  assert.match(css, /body:has\(#replay:not\(\.hidden\)\) #autoBadge \{ display: none; \}/);
});

test('the round buttons form one row in the top-right corner; the full-screen button has its own enter / leave icons', async () => {
  const css = read('src/style.css');
  const right = (id) => Number(new RegExp(`#${id} \\{ position: fixed; top: 14px; right: (\\d+)px`).exec(css)[1]);
  assert.deepEqual(['muteBtn', 'fsBtn', 'hudSettings', 'hudTeam'].map(right), [14, 68, 122, 176], 'same top, 54 px apart');
  const { FS_ENTER, FS_EXIT } = await import('../src/icons.js');
  assert.match(FS_ENTER, /^<svg/); assert.match(FS_EXIT, /^<svg/); assert.notEqual(FS_ENTER, FS_EXIT);
  assert.doesNotMatch(read('index.html'), /⛶|🗗/ , 'no emoji glyph for the full-screen button');
});
