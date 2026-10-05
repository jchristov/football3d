import test from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, STYLE_KEYS, styleByKey } from '../src/styles.js';
import { TEAMS, styleOfTeam } from '../src/teams.js';
import { cpuTactics, formationsFor } from '../src/tactics.js';
import { TEAM_SIZES } from '../src/constants.js';
import { makeGame, startCpuMatch, runUntil, seedRandom, resetGlobals } from './helpers.js';

test.beforeEach(() => resetGlobals());

test('every style has a label, a description and sane multipliers; every team has a known style', () => {
  assert.deepEqual(STYLE_KEYS, ['balanced', 'possession', 'counter', 'longball', 'press']);
  for (const s of Object.values(STYLES)) {
    assert.ok(s.label && s.desc);
    for (const k of ['forward', 'distance', 'lob', 'shoot', 'tackle', 'speed']) assert.ok(s[k] > 0 && s[k] < 4, `${s.key}.${k}`);
    for (const k of ['passFree', 'passPressed']) assert.ok(s[k] > 0 && s[k] <= 1);
  }
  assert.equal(styleByKey('nonsense'), STYLES.balanced);
  for (let i = 0; i < TEAMS.length; i++) assert.ok(STYLE_KEYS.includes(TEAMS[i].style), TEAMS[i].name);
  assert.ok(new Set(TEAMS.map((t) => t.style)).size >= 4, 'the league has variety');
  assert.equal(styleOfTeam(0), STYLES.possession);
});

test('a style decides the shape and pressing of a CPU team, at every team size', () => {
  for (const n of TEAM_SIZES) {
    const tags = (key) => formationsFor(n).find((f) => f.key === cpuTactics(3, n, STYLES[key]).formation).tag;
    assert.equal(tags('counter'), 'park'); assert.equal(tags('longball'), 'attack'); assert.equal(tags('possession'), 'diamond');
    assert.equal(cpuTactics(3, n, STYLES.press).press, 'high');
    assert.equal(cpuTactics(3, n, STYLES.counter).press, 'low');
    assert.deepEqual(cpuTactics(3, n, STYLES.balanced), cpuTactics(3, n), 'balanced = by rating, as before');
  }
});

test('human teams play balanced, CPU teams play their own style', () => {
  const g = makeGame();
  startCpuMatch(g, { mode: '1p', teams: [0, 1], length: 60 });
  assert.equal(g.styles[0], STYLES.balanced, 'the human side');
  assert.equal(g.styles[1], styleOfTeam(1));
  startCpuMatch(g, { mode: 'cpu', teams: [0, 4], length: 60 });
  assert.equal(g.styles[0], styleOfTeam(0)); assert.equal(g.styles[1], styleOfTeam(4));
  assert.equal(g.lineups.tactics[1].press, 'low', 'long ball team sits back');
});

// Play CPU matches where team 0 uses `style` against a fixed opponent and record how it passes
function observe(style, seeds = [3, 8, 14]) {
  let passes = 0, dist = 0, lobs = 0, shots = 0, tackles = 0;
  for (const seed of seeds) {
    seedRandom(seed);
    const g = makeGame();
    startCpuMatch(g, { mode: 'cpu', teams: [3, 6], length: 120 });
    g.styles = [STYLES[style], STYLES.balanced];
    const pass = g.passTo.bind(g), lob = g.lobTo.bind(g);
    g.passTo = (p, t, ...r) => { const ok = pass(p, t, ...r); if (ok && p.team === 0) { passes++; dist += Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z); } return ok; };
    g.lobTo = (p, t) => { const ok = lob(p, t); if (ok && p.team === 0) { lobs++; passes++; dist += Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z); } return ok; };
    runUntil(g, () => g.state === 'ended' || g.state === 'halftime', 150);
    if (g.state === 'halftime') g.endHalftime();
    runUntil(g, () => g.state === 'ended', 200);
    shots += g.stats.shots[0]; tackles += g.stats.tackles[0];
  }
  return { passes, avg: dist / Math.max(1, passes), lobs, shots, tackles };
}

test('possession teams pass shorter and more often than long-ball teams, who lob far more', () => {
  const pos = observe('possession'), lng = observe('longball');
  assert.ok(pos.avg < lng.avg, `average pass: possession ${pos.avg.toFixed(1)} m vs long ball ${lng.avg.toFixed(1)} m`);
  assert.ok(lng.lobs > pos.lobs * 1.5 || lng.lobs >= pos.lobs + 4, `lobs: long ball ${lng.lobs} vs possession ${pos.lobs}`);
  assert.ok(pos.passes > 0 && lng.passes > 0);
});

test('every style plays a complete match at every team size without errors', () => {
  for (const n of TEAM_SIZES) for (const key of STYLE_KEYS) {
    seedRandom(50 + n);
    const g = makeGame();
    startCpuMatch(g, { mode: 'cpu', teams: [0, 1], length: 40, size: n });
    g.styles = [STYLES[key], STYLES[key === 'press' ? 'counter' : 'press']];
    runUntil(g, () => g.state === 'ended' || g.state === 'halftime', 90);
    if (g.state === 'halftime') g.endHalftime();
    runUntil(g, () => g.state === 'ended', 120);
    assert.equal(g.state, 'ended', `${n}-a-side ${key}`);
    for (const p of g.all) assert.ok(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z));
  }
});
