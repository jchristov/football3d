import test from 'node:test';
import assert from 'node:assert/strict';
import { TEAMS, Tournament, squad, pickKits, makeDiff, simulateMatch, colorDist } from '../src/teams.js';
import { seedRandom } from './helpers.js';

test('every player in the game has a unique surname and valid squad numbers', () => {
  const names = TEAMS.flatMap((_, i) => squad(i).map((p) => p.name));
  assert.equal(new Set(names).size, names.length);
  for (let i = 0; i < TEAMS.length; i++) {
    assert.equal(squad(i).length, 16, '11 starters + 5 on the bench');
    assert.deepEqual(squad(i).map((p) => p.num).slice(0, 8), [1, 4, 8, 10, 9, 3, 7, 11], 'the 5-a-side numbering is unchanged');
    assert.equal(new Set(squad(i).map((p) => p.num)).size, 16, 'no shirt number is used twice in a team');
    assert.equal(squad(i).filter((p) => p.captain).length, 1, 'exactly one captain');
  }
});

test('kits avoid colour clashes and keepers stand out', () => {
  for (let a = 0; a < TEAMS.length; a++) for (let b = 0; b < TEAMS.length; b++) {
    if (a === b) continue;
    const k = pickKits(a, b);
    assert.ok(colorDist(k.outfield[0].shirt, k.outfield[1].shirt) >= 100, `${TEAMS[a].code} v ${TEAMS[b].code}`);
    for (const gk of k.gk) for (const o of k.outfield) assert.ok(colorDist(gk.shirt, o.shirt) > 60);
    assert.notEqual(k.gk[0].shirt, k.gk[1].shirt);
  }
});

test('team rating shifts CPU skill monotonically', () => {
  const weak = makeDiff('normal', 1), mid = makeDiff('normal', 3), strong = makeDiff('normal', 5);
  assert.ok(weak.speed < mid.speed && mid.speed < strong.speed);
  assert.ok(weak.save < strong.save && weak.react > strong.react);
});

test('simulated knockout fixtures are never drawn; stronger sides win more often', () => {
  seedRandom(7);
  let strongWins = 0;
  const strong = TEAMS.findIndex((t) => t.rating === 5), weak = TEAMS.findIndex((t) => t.rating === 2);
  for (let i = 0; i < 400; i++) {
    const [a, b, pens] = simulateMatch(strong, weak, true);
    if (a === b) assert.ok(pens === 0 || pens === 1);
    if (a > b || (a === b && pens === 0)) strongWins++;
  }
  assert.ok(strongWins > 240, `strong side won ${strongWins}/400`);
});

test('cup: 8 teams, 3 rounds, exactly one champion', () => {
  seedRandom(11);
  const t = new Tournament('cup', 6, 'normal');
  assert.equal(t.fixtures.length, 4);
  let rounds = 0;
  while (!t.over) {
    const uf = t.userFixture;
    assert.ok(uf, 'user is still in the cup');
    t.report({ score: [2, 0], winner: 0 });
    rounds++;
  }
  assert.equal(rounds, 3);
  assert.equal(t.champion, 6);
});

test('cup: losing a match knocks the user out immediately', () => {
  seedRandom(12);
  const t = new Tournament('cup', 0, 'normal');
  t.report({ score: [0, 1], winner: 1 });
  assert.ok(t.over);
  assert.equal(t.userOut, true);
  assert.equal(t.champion, null);
});

test('cup: penalty winner decides a level game', () => {
  seedRandom(13);
  const t = new Tournament('cup', 0, 'normal');
  t.report({ score: [1, 1], winner: 0 });
  assert.equal(t.userOut, false);
  assert.ok(!t.over);
});

test('league: 6 teams play 5 matchdays; points add up and the table is sorted', () => {
  seedRandom(21);
  const t = new Tournament('league', 2, 'normal');
  assert.equal(t.schedule.length, 5);
  let days = 0;
  while (!t.over) { assert.ok(t.userFixture); t.report({ score: [1, 0], winner: 0 }); days++; }
  assert.equal(days, 5);
  const table = t.standings();
  assert.equal(table.length, 6);
  for (const r of table) assert.equal(r.w + r.d + r.l, 5);
  for (let i = 1; i < table.length; i++) assert.ok(table[i - 1].p >= table[i].p);
  assert.equal(table.reduce((s, r) => s + r.gf, 0), table.reduce((s, r) => s + r.ga, 0), 'goals for = goals against');
  assert.equal(table[0].team, 2, 'user won everything, so tops the table');
});

test('league: every pair meets exactly once', () => {
  const t = new Tournament('league', 0, 'normal');
  const seen = new Set();
  for (const day of t.schedule) for (const f of day) {
    const k = [f.a, f.b].sort().join('-');
    assert.ok(!seen.has(k)); seen.add(k);
  }
  assert.equal(seen.size, 15);
});
