import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runUntil, step, startCpuMatch, seedRandom, resetGlobals } from './helpers.js';
import { PITCH, MATCH, TEAM_SIZES, PITCH_SIZES, BENCH_SIZES, benchSize, setPitchForSize, GOAL } from '../src/constants.js';
import { formationsFor, homeSlots, layout, resolveFormation, cpuTactics, chasersFor, PRESS, formationOf, FORMATIONS_BY_SIZE } from '../src/tactics.js';
import { squad } from '../src/teams.js';
import { settings } from '../src/settings.js';

test.beforeEach(() => resetGlobals());

test('the six team sizes each have a pitch, a bench and five formations', () => {
  assert.deepEqual(TEAM_SIZES, [3, 4, 5, 7, 9, 11]);
  let prev = 0;
  for (const n of TEAM_SIZES) {
    assert.ok(PITCH_SIZES[n].hl > prev, 'pitches grow with the team size'); prev = PITCH_SIZES[n].hl;
    assert.ok(PITCH_SIZES[n].hl > PITCH_SIZES[n].hw);
    assert.ok(benchSize(n) >= 2 && benchSize(n) <= 5);
    assert.equal(formationsFor(n).length, 5, `size ${n}`);
  }
  assert.equal(PITCH_SIZES[5].hl, 25); assert.equal(PITCH_SIZES[5].hw, 16, '5-a-side keeps the original pitch');
  setPitchForSize(11);
  assert.equal(MATCH.size, 11); assert.equal(PITCH.hl, 50); assert.ok(PITCH.s > 1.9 && PITCH.speed > 1);
  setPitchForSize(99);
  assert.equal(MATCH.size, 5, 'an unknown size falls back to 5');
});

test('every formation fits its team size exactly and stays on the pitch', () => {
  for (const n of TEAM_SIZES) {
    setPitchForSize(n);
    for (const f of formationsFor(n)) {
      assert.equal(f.lines.reduce((a, b) => a + b, 0), n - 1, `${n}: ${f.key} has the right number of outfield players`);
      const slots = homeSlots(f.key, n);
      assert.equal(slots.length, n); assert.equal(slots[0].role, 'GK');
      for (const s of slots.slice(1)) {
        assert.ok(s.lx > 2 && s.lx < 2 * PITCH.hl - 2, `${n} ${f.key} lx ${s.lx}`);
        assert.ok(Math.abs(s.lz) < PITCH.hw * 0.95, `${n} ${f.key} lz ${s.lz}`);
        assert.ok(['DEF', 'MID', 'FWD'].includes(s.role));
      }
      // no two players start on top of each other
      const pts = slots.slice(1);
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(Math.hypot(pts[i].lx - pts[j].lx, pts[i].lz - pts[j].lz) > 1.5, `${n} ${f.key}: overlap`);
    }
  }
});

test('formation lines read from defence to attack; attack formations sit further up than park-the-bus', () => {
  for (const n of TEAM_SIZES) {
    const depth = (tag) => { const f = formationsFor(n).find((x) => x.tag === tag); return layout(f).reduce((a, s) => a + s.nx, 0) / (n - 1); };
    assert.ok(depth('attack') > depth('park'), `size ${n}`);
  }
  const f = formationsFor(11).find((x) => x.key === '4-4-2');
  const L = layout(f);
  assert.deepEqual([4, 4, 2].map((c, i) => L.filter((s) => s.role === ['DEF', 'MID', 'FWD'][i]).length), [4, 4, 2]);
});

test('a stored formation that does not exist at another team size falls back to a balanced one', () => {
  assert.equal(resolveFormation('4-4-2', 5), 'balanced');
  assert.equal(resolveFormation('balanced', 11), '4-4-2');
  assert.equal(resolveFormation('4-4-2', 11), '4-4-2');
  assert.equal(formationOf({ formation: 'park' }, 7).key, '3-3-1'.length ? formationsFor(7)[0].key : '');
});

test('CPU tactics and pressing scale with the team size', () => {
  for (const n of TEAM_SIZES) for (const r of [1, 2, 3, 4, 5]) assert.ok(formationsFor(n).some((f) => f.key === cpuTactics(r, n).formation), `${n}/${r}`);
  assert.equal(chasersFor(PRESS.balanced, 5), 2);
  assert.ok(chasersFor(PRESS.balanced, 11) > chasersFor(PRESS.balanced, 5));
  assert.ok(chasersFor(PRESS.high, 3) >= 1 && chasersFor(PRESS.low, 3) === 1);
  assert.ok(chasersFor(PRESS.balanced, 11) < 6, 'a bigger team does not all chase the ball');
});

test('a game is played with the chosen number of players, a matching pitch, bench and squad', () => {
  for (const n of TEAM_SIZES) {
    seedRandom(100 + n);
    const g = makeGame();
    startCpuMatch(g, { length: 40, size: n });
    assert.equal(MATCH.size, n);
    assert.equal(g.teams[0].length, n); assert.equal(g.teams[1].length, n);
    assert.equal(g.all.length, 2 * n);
    assert.equal(PITCH.hl, PITCH_SIZES[n].hl);
    assert.equal(g.teams[0].filter((p) => p.isGK).length, 1);
    assert.equal(g.lineups.onPitch[0].length, n); assert.equal(g.lineups.bench[0].length, benchSize(n));
    assert.equal(g.pool[0].filter((p) => p.mesh.visible).length, n, 'only the playing members are shown');
    const nums = g.teams[0].map((p) => p.num); assert.equal(new Set(nums).size, n, 'distinct shirt numbers');
    runUntil(g, () => g.state === 'ended' || g.state === 'halftime', 120);
    if (g.state === 'halftime') g.endHalftime();
    runUntil(g, () => g.state === 'ended', 200);
    assert.equal(g.state, 'ended', `${n}-a-side match finishes`);
    for (const p of g.all) { assert.ok(Math.abs(p.pos.x) <= PITCH.hl && Math.abs(p.pos.z) <= PITCH.hw, `${n}: player on the pitch`); assert.ok(Number.isFinite(p.energy)); }
    assert.ok(Number.isFinite(g.ball.pos.x));
  }
});

test('the kick-off layout respects the centre circle for every size', () => {
  for (const n of TEAM_SIZES) {
    seedRandom(5);
    const g = makeGame();
    startCpuMatch(g, { length: 60, size: n });
    const circle = 4.5 * PITCH.s;
    for (const kick of [0, 1]) {
      g.resetKickoff(kick);
      for (const p of g.teams[1 - kick]) assert.ok(Math.hypot(p.pos.x, p.pos.z) >= circle - 0.2, `${n}: opponent inside the centre circle`);
      for (const t of [0, 1]) for (const p of g.teams[t]) {
        const own = t === 0 ? p.pos.x <= 0.01 : p.pos.x >= -0.01; // teams start in their own half (first half)
        assert.ok(own, `${n}: a player starts in the other half`);
      }
    }
  }
});

test('free kicks, penalties and the wall adapt to the team size', () => {
  for (const n of [3, 7, 11]) {
    seedRandom(7 + n);
    const g = makeGame();
    startCpuMatch(g, { mode: '1p', length: 600, size: n });
    g.ctrls[0].enabled = false;
    runUntil(g, () => g.state === 'playing', 20);
    g.rules.reset();
    // penalty
    g.rules.startSetPiece('penalty', 0, null);
    assert.equal(g.state, 'setpiece');
    const spot = Math.abs(g.ball.pos.x), expect = PITCH.hl - 4.5 * PITCH.s;
    assert.ok(Math.abs(spot - expect) < 0.01, `${n}: penalty spot ${spot} vs ${expect}`);
    for (const p of g.all) assert.ok(Math.abs(p.pos.x) <= PITCH.hl && Math.abs(p.pos.z) <= PITCH.hw, `${n}: set-piece player on the pitch`);
    // free kick with a wall
    g.rules.reset(); g.resetKickoff(0); runUntil(g, () => g.state === 'playing', 20);
    g.rules.startSetPiece('free', 0, { x: PITCH.hl - 14 * Math.sqrt(PITCH.s), z: 3 });
    const wall = g.teams[1].filter((p) => !p.isGK && Math.hypot(p.pos.x - g.ball.pos.x, p.pos.z - g.ball.pos.z) < 7 * PITCH.s);
    assert.ok(wall.length >= 1 && wall.length <= 4, `${n}: wall of ${wall.length}`);
    runUntil(g, () => g.state === 'playing' || g.state === 'ended', 30);
  }
});

test('substitutions work at every size and keep the squad consistent', () => {
  for (const n of TEAM_SIZES) {
    const g = makeGame(); startCpuMatch(g, { length: 60, size: n });
    const L = g.lineups;
    const r = L.substitute(0, n - 1, 0);
    assert.ok(r, `${n}: outfield substitution`);
    assert.equal(L.substitute(0, 0, 0), null, 'keeper stays');
    assert.equal(L.substitute(0, n, 0), null, 'there is no such pitch slot');
    const all = [...L.onPitch[0], ...L.bench[0]];
    assert.equal(new Set(all).size, n + benchSize(n));
    assert.ok(all.every((s) => s < 16));
  }
});

test('a goal scored on a big pitch is detected at the goal line; shots and keepers still work', () => {
  seedRandom(33);
  const g = makeGame();
  startCpuMatch(g, { length: 600, size: 11 });
  runUntil(g, () => g.state === 'playing', 20);
  g.rules.reset(); g.resetKickoff(0); runUntil(g, () => g.state === 'playing', 20);
  g.teams[1][0].saveCd = 1e9;
  const striker = g.teams[0][g.teams[0].length - 1];
  striker.place(PITCH.hl - 8, 0, 0);
  g.ball.reset(PITCH.hl - 7, 0); g.ball.owner = striker; g.ball.lastToucher = striker; g.ball.vel.set(24, 0.4, 0);
  step(g, 1.5);
  assert.equal(g.score[0], 1);
});

test('the pitch scales with the team size: players cover more ground on bigger pitches', () => {
  const sp = (n) => { resetGlobals(); setPitchForSize(n); return PITCH.speed; };
  assert.ok(sp(3) < sp(5) && sp(5) < sp(11));
  assert.equal(sp(5), 1);
});

test('settings default to 5-a-side', () => { assert.equal(settings.teamSize, 5); });
