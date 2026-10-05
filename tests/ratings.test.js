import test from 'node:test';
import assert from 'node:assert/strict';
import { rate, computeRatings, manOfTheMatch, BASE_RATING } from '../src/ratings.js';
import { makeGame, startCpuMatch, runUntil, step, seedRandom, resetGlobals } from './helpers.js';

test.beforeEach(() => resetGlobals());

const blank = (over = {}) => ({ key: 'x', team: 0, slot: 2, role: 'MID', goals: 0, assists: 0, onTarget: 0, shots: 0, passes: 0, passesOk: 0, tackles: 0, saves: 0, headers: 0, fouls: 0, yellows: 0, reds: 0, ownGoals: 0, seconds: 100, ...over });

test('an average performance is rated around 6', () => {
  assert.equal(rate(blank()), BASE_RATING);
});

test('goals, assists, tackles and saves raise a rating; fouls, cards and own goals lower it', () => {
  const base = rate(blank());
  assert.ok(rate(blank({ goals: 2 })) > rate(blank({ goals: 1 })) && rate(blank({ goals: 1 })) > base);
  assert.ok(rate(blank({ assists: 1 })) > base);
  assert.ok(rate(blank({ tackles: 3 })) > base);
  assert.ok(rate(blank({ role: 'GK', saves: 4 })) > rate(blank({ role: 'GK' })));
  assert.ok(rate(blank({ fouls: 2 })) < base);
  assert.ok(rate(blank({ yellows: 1 })) < base);
  assert.ok(rate(blank({ reds: 1 })) < rate(blank({ yellows: 1 })));
  assert.ok(rate(blank({ ownGoals: 1 })) < base);
});

test('the result counts: wins add, defeats subtract, clean sheets reward keepers and defenders', () => {
  assert.ok(rate(blank(), { won: true }) > rate(blank()));
  assert.ok(rate(blank(), { lost: true }) < rate(blank()));
  assert.ok(rate(blank({ role: 'DEF' }), { conceded: 0 }) > rate(blank({ role: 'DEF' }), { conceded: 2 }));
  assert.ok(rate(blank({ role: 'GK' }), { conceded: 4 }) < rate(blank({ role: 'GK' }), { conceded: 0 }));
});

test('ratings stay between 3 and 10 and a short appearance changes the mark less', () => {
  assert.equal(rate(blank({ goals: 20 })), 10);
  assert.equal(rate(blank({ reds: 5, fouls: 9, ownGoals: 3 })), 3);
  assert.ok(rate(blank({ goals: 2 }), { minutesShare: 0.1 }) < rate(blank({ goals: 2 }), { minutesShare: 1 }));
});

test('passing accuracy matters a little', () => {
  assert.ok(rate(blank({ passes: 20, passesOk: 19 })) > rate(blank({ passes: 20, passesOk: 8 })));
});

test('the man of the match comes from the winning team (or from everybody in a draw)', () => {
  const list = [blank({ key: 'a', team: 1, rating: 9 }), blank({ key: 'b', team: 0, rating: 8 }), blank({ key: 'c', team: 0, rating: 7 })];
  assert.equal(manOfTheMatch(list, [2, 1]).key, 'b');
  assert.equal(manOfTheMatch(list, [1, 1]).key, 'a');
  assert.equal(manOfTheMatch([], [0, 0]), null);
});

test('a played match produces ratings for the players on the pitch and a man of the match', () => {
  seedRandom(31);
  const g = makeGame();
  startCpuMatch(g, { length: 90 });
  runUntil(g, () => g.state === 'ended' || g.state === 'halftime', 120);
  if (g.state === 'halftime') g.endHalftime();
  runUntil(g, () => g.state === 'ended', 200);
  assert.ok(g.ratings.length >= 10, `${g.ratings.length} rated players`);
  for (const r of g.ratings) { assert.ok(r.rating >= 3 && r.rating <= 10); assert.ok(r.seconds > 0); }
  assert.ok(g.motm, 'there is a man of the match');
  const [h, aw] = g.score;
  const pool = h === aw ? g.ratings : g.ratings.filter((r) => r.team === (h > aw ? 0 : 1));
  assert.equal(g.motm.rating, Math.max(...pool.map((r) => r.rating)));
  const goalsRated = g.ratings.reduce((a, r) => a + r.goals, 0);
  const goalsScored = g.stats.goals.filter((x) => !x.own).length;
  assert.equal(goalsRated, goalsScored, 'every non-own goal is credited to a player');
});

test('assists are credited to the passer of the last completed pass before a goal', () => {
  seedRandom(2);
  const g = makeGame();
  startCpuMatch(g, { length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  const [passer, scorer] = [g.teams[0][2], g.teams[0][3]];
  g.stats.pass(passer);
  g.stats.touch(scorer, g.time);
  g.stats.recGoal(scorer, false, g.time + 2);
  assert.equal(g.stats.rec(passer).assists, 1);
  assert.equal(g.stats.rec(scorer).goals, 1);
  // too long ago: no assist
  g.stats.recGoal(scorer, false, g.time + 30);
  assert.equal(g.stats.rec(passer).assists, 1);
});
