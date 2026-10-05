import test from 'node:test';
import assert from 'node:assert/strict';
import { squad, specialityFor, TEAMS } from '../src/teams.js';
import { makeGame, startCpuMatch, resetGlobals } from './helpers.js';

test.beforeEach(() => resetGlobals());

test('every squad member has a speciality that adds up to 100% and matches his natural role', () => {
  for (let t = 0; t < TEAMS.length; t++) for (const m of squad(t)) {
    const s = m.spec;
    assert.ok(s, `${t}-${m.slot}`);
    if (m.role === 'GK') { assert.equal(s.gk, true); assert.equal(s.main, 'GK'); assert.equal(s.def + s.mid + s.att, 100); assert.ok(s.def >= 70, `a keeper is mostly green: ${JSON.stringify(s)}`); continue; }
    assert.equal(s.def + s.mid + s.att, 100, `${m.id} sums to 100`);
    for (const v of [s.def, s.mid, s.att]) assert.ok(v >= 5 && Number.isInteger(v));
    const top = Math.max(s.def, s.mid, s.att);
    const expect = { DEF: s.def, MID: s.mid, FWD: s.att }[m.role];
    assert.equal(expect, top, `${m.id} (${m.role}) is strongest in his own role: ${JSON.stringify(s)}`);
    assert.equal(s.main, m.role);
  }
});

test('goalkeepers are all green by default; only some have an extra quality (midfield or attack)', () => {
  let pure = 0, extra = 0;
  for (let t = 0; t < TEAMS.length; t++) { const s = squad(t)[0].spec; if (s.mid === 0 && s.att === 0) { pure++; assert.equal(s.def, 100); } else extra++; }
  assert.ok(pure >= 1 && extra >= 1, `${pure} pure keepers, ${extra} with extras`);
  let all = 0;
  for (let t = 0; t < 1000; t++) { const s = specialityFor(t, 0, 'GK'); if (s.mid === 0 && s.att === 0) all++; }
  assert.ok(all > 450 && all < 650, `about half of all keepers are pure green (${all}/1000)`);
  for (let t = 0; t < 100; t++) { const s = specialityFor(t, 0, 'GK'); assert.equal(s.def + s.mid + s.att, 100); assert.ok(s.def >= 70); }
});

test('the speciality is stable and varies between players of the same role', () => {
  assert.deepEqual(specialityFor(2, 5, 'DEF'), specialityFor(2, 5, 'DEF'));
  const defs = new Set();
  for (let t = 0; t < TEAMS.length; t++) for (const m of squad(t)) if (m.role === 'DEF') defs.add(`${m.spec.def}/${m.spec.mid}/${m.spec.att}`);
  assert.ok(defs.size > 5, `${defs.size} different defender profiles`);
});

test('players on the pitch carry the speciality of the squad member they represent, also after a substitution', () => {
  const g = makeGame();
  startCpuMatch(g, { length: 60 });
  for (const p of g.teams[0]) assert.deepEqual(p.spec, g.lineups.member(0, p.index).spec);
  const outSpec = g.teams[0][2].spec;
  g.substitute(0, 2, 0);
  assert.notDeepEqual(g.teams[0][2].spec, outSpec);
  assert.deepEqual(g.teams[0][2].spec, g.lineups.member(0, 2).spec);
});
