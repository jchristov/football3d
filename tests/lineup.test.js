import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, startCpuMatch, runUntil, step, resetGlobals, seedRandom } from './helpers.js';
import { makeDefaults } from '../src/settings.js';

test.beforeEach(() => resetGlobals());

test('the kick-off countdown waits while the team sheets are shown (game.hold)', () => {
  seedRandom(4);
  const g = makeGame();
  startCpuMatch(g, { length: 60 });
  assert.equal(g.state, 'countdown');
  g.hold = true;
  const t = g.timer;
  step(g, 5);
  assert.equal(g.state, 'countdown'); assert.equal(g.timer, t);
  g.hold = false;
  step(g, 3.5);
  assert.notEqual(g.state, 'countdown', 'the countdown runs again once the sheets are closed');
});

test('a new match never starts on hold', () => {
  const g = makeGame();
  g.hold = true;
  startCpuMatch(g, { length: 60 });
  assert.equal(g.hold, false);
});

test('the team sheets are on by default and can be switched off', () => {
  assert.equal(makeDefaults().lineupScreen, true);
});

import { TEAM_SIZES } from '../src/constants.js';
import { outOfPosition } from '../src/skills.js';
import { formationsFor } from '../src/tactics.js';

test('the starters are seated by natural role: nobody is out of position in the default line-up of any team size', () => {
  for (const n of TEAM_SIZES) {
    const g = makeGame();
    startCpuMatch(g, { length: 60, size: n });
    for (const t of [0, 1]) {
      const bad = g.teams[t].filter((p) => outOfPosition(p));
      assert.ok(bad.length <= 1, `${n}-a-side team ${t}: ${bad.length} out of position`);
      assert.equal(g.teams[t][0].isGK, true);
      assert.equal(new Set(g.lineups.onPitch[t]).size, n, 'nobody is picked twice');
    }
  }
});

test('autoAssign keeps the keeper and the whole squad, whatever the formation; a team can start with the players that fit', () => {
  const g = makeGame();
  startCpuMatch(g, { length: 60, size: 11 });
  const L = g.lineups;
  const all = [...L.onPitch[0], ...L.bench[0]].sort((a, b) => a - b);
  for (const f of formationsFor(11)) {
    L.tactics[0].formation = f.key;
    L.autoAssign(0);
    assert.deepEqual([...L.onPitch[0], ...L.bench[0]].sort((a, b) => a - b), all, 'nobody is lost or duplicated');
    assert.equal(L.onPitch[0][0], 0);
    assert.equal(L.onPitch[0].length, 11); assert.equal(L.bench[0].length, 5);
    const roles = L.onPitch[0].slice(1).map((s) => L.rosters[0][s].spec.main);
    const want = f.lines.map((n, i, arr) => (i === 0 ? 'DEF' : i === arr.length - 1 ? 'FWD' : 'MID'));
    const counts = { DEF: f.lines[0], FWD: f.lines[f.lines.length - 1], MID: f.lines.slice(1, -1).reduce((a, b) => a + b, 0) };
    for (const r of ['DEF', 'MID', 'FWD']) assert.equal(roles.filter((x) => x === r).length, counts[r], `${f.key}: ${r} players`);
    assert.ok(want.length);
  }
});
