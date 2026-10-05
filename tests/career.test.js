import test from 'node:test';
import assert from 'node:assert/strict';
import { Career, avg } from '../src/career.js';
import { Tournament, TEAMS, squad } from '../src/teams.js';
import { seedRandom, resetGlobals, makeGame, startCpuMatch, runUntil, step } from './helpers.js';
import { aptitude } from '../src/skills.js';
import { formGuideHtml, scorersHtml, squadHtml, seasonsHtml, seasonSummaryHtml } from '../src/careerui.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
test.beforeEach(() => { resetGlobals(); globalThis.localStorage = mem(); seedRandom(3); });

// a played match of the user's team as the game reports it
const played = (score, players = []) => ({ score, winner: score[0] > score[1] ? 0 : score[0] < score[1] ? 1 : null, discipline: {},
  ratings: players.map((p) => ({ team: 0, goals: 0, assists: 0, yellows: 0, reds: 0, rating: 6, seconds: 100, ...p })) });
const play = (c, r) => { const t = c.tour, opp = t.userFixture.opponent; c.recordMatch(r, opp); t.report({ score: r.score, winner: r.winner }); c.recordRound(); return opp; };

test('a career season is a double round robin of six teams: ten matchdays, everybody meets everybody twice', () => {
  const c = new Career(2, 'normal');
  const t = c.tour;
  assert.equal(t.teams.length, 6); assert.equal(t.schedule.length, 10);
  const pairs = new Map();
  for (const day of t.schedule) { assert.equal(day.length, 3); for (const f of day) { const k = [f.a, f.b].sort().join('-'); pairs.set(k, (pairs.get(k) || 0) + 1); } }
  assert.equal(pairs.size, 15); assert.ok([...pairs.values()].every((n) => n === 2));
  // return legs swap home and away
  assert.deepEqual(t.schedule[5].map((f) => [f.b, f.a]), t.schedule[0].map((f) => [f.a, f.b]));
  assert.ok(!c.opponents.includes(2) && new Set(c.opponents).size === 5);
});

test('a career survives saving and loading in the middle of a season', () => {
  const c = new Career(1, 'hard');
  play(c, played([2, 0], [{ slot: 4, goals: 2, rating: 8.5 }, { slot: 1, rating: 6.5 }]));
  play(c, played([0, 1], [{ slot: 4, rating: 5.5, yellows: 1 }]));
  c.save();
  const d = Career.load();
  assert.equal(d.user, 1); assert.equal(d.diffKey, 'hard'); assert.equal(d.tour.round, 2);
  assert.deepEqual(d.tour.fixtures, c.tour.fixtures);
  assert.equal(d.tour.fixtures, d.tour.schedule[2], 'the current round is the schedule entry again');
  assert.equal(d.squad[4].apps, 2); assert.equal(d.squad[4].goals, 2);
  assert.deepEqual(d.userForm(), ['W', 'L']);
  assert.equal(d.tour.standings()[0].p >= 0, true);
  play(d, played([1, 1])); // the loaded career keeps working
  assert.equal(d.tour.round, 3);
  Career.clear(); assert.equal(Career.load(), null);
});

test('a broken save is ignored', () => {
  localStorage.setItem('football3d.career', '{nope');
  assert.equal(Career.load(), null);
  localStorage.setItem('football3d.career', JSON.stringify({ user: 'x' }));
  assert.equal(Career.load(), null);
});

test('the squad collects appearances, goals, assists, cards and ratings; the form guide follows the results', () => {
  const c = new Career(0, 'normal');
  play(c, played([3, 0], [{ slot: 4, goals: 2, assists: 0, rating: 9 }, { slot: 3, goals: 1, assists: 1, rating: 7.5 }, { slot: 1, rating: 6 }]));
  play(c, played([1, 1], [{ slot: 4, goals: 0, yellows: 1, rating: 5.5 }]));
  play(c, played([0, 2], [{ slot: 4, reds: 1, rating: 4 }]));
  const r = Object.fromEntries(c.squadRows().map((x) => [x.slot, x]));
  assert.equal(r[4].apps, 3); assert.equal(r[4].goals, 2); assert.equal(r[4].yellows, 1); assert.equal(r[4].reds, 1);
  assert.ok(Math.abs(r[4].rating - avg([9, 5.5, 4])) < 1e-9);
  assert.equal(r[3].assists, 1);
  assert.deepEqual(c.userForm(), ['W', 'D', 'L']);
  for (let i = 0; i < 5; i++) play(c, played([1, 0]));
  assert.equal(c.userForm().length, 5, 'only the last five');
  assert.equal(c.userForm().join(''), 'WWWWW'.slice(0, 5));
});

test('the top scorers table counts real goals of both teams of the user\'s match and simulated ones of the others', () => {
  const c = new Career(0, 'normal');
  const opp = c.tour.userFixture.opponent;
  const r = played([2, 1], [{ slot: 4, goals: 2 }]);
  r.ratings.push({ team: 1, slot: 5, goals: 1, assists: 0, yellows: 0, reds: 0, rating: 6, seconds: 100 });
  c.recordMatch(r, opp);
  c.tour.report({ score: r.score, winner: r.winner }); c.recordRound();
  const sc = c.scorers;
  assert.equal(sc[`0-4`].goals, 2); assert.equal(sc[`${opp}-5`].goals, 1);
  const others = c.tour.history[0].fixtures.filter((f) => f.a !== 0 && f.b !== 0);
  const simGoals = others.reduce((a, f) => a + f.result.ga + f.result.gb, 0);
  const total = Object.entries(sc).filter(([k]) => k !== '0-4' && k !== `${opp}-5`).reduce((a, [, e]) => a + e.goals, 0);
  assert.equal(total, simGoals, 'every simulated goal has a scorer');
  const top = c.topScorers(3);
  assert.equal(top[0].goals >= top[1].goals, true); assert.ok(top[0].name && top[0].num);
  assert.ok(c.topScorers(1)[0].goals >= 2);
});

test('simulated goals go mostly to forwards and hardly ever to goalkeepers', () => {
  const c = new Career(0, 'normal'); const n = {};
  for (let i = 0; i < 4000; i++) { const role = squad(3)[c.pickScorer(3)].role; n[role] = (n[role] || 0) + 1; }
  assert.ok(n.FWD > n.MID && n.MID > n.DEF, JSON.stringify(n));
  assert.ok((n.GK || 0) < 60, JSON.stringify(n));
});

test('good and poor runs of marks change the skill of a player a little', () => {
  const c = new Career(0, 'normal');
  const rate = (slot, ...marks) => marks.forEach((m) => c.recordMatch(played([1, 0], [{ slot, rating: m }]), 1));
  rate(4, 8, 8.5, 7.8); rate(3, 5, 5.2, 5.4); rate(2, 6.5, 6.4, 6.6); rate(1, 9);
  const f = c.formMul();
  assert.equal(f[4], 1.05); assert.equal(f[3], 0.95); assert.equal(f[2], undefined); assert.equal(f[1], undefined, 'one match is not a run');
  assert.equal(c.formState(4), 'hot'); assert.equal(c.formState(3), 'cold'); assert.equal(c.formState(2), null);
  const p = { spec: { def: 30, mid: 40, att: 30 }, role: 'MID', isGK: false };
  assert.ok(aptitude({ ...p, form: 1.05 }, 'mid') > aptitude(p, 'mid') && aptitude({ ...p, form: 0.95 }, 'mid') < aptitude(p, 'mid'));
});

test('the form of the career reaches the players on the pitch', () => {
  const g = makeGame();
  startCpuMatch(g, { length: 60, form: { 3: 1.05, 4: 0.95 } });
  const by = (s) => g.teams[0].concat(g.teams[1]).find((p) => p.team === 0 && p.squadSlot === s);
  const slots = g.teams[0].map((p) => p.squadSlot);
  for (const p of g.teams[0]) assert.equal(p.form, { 3: 1.05, 4: 0.95 }[p.squadSlot] ?? 1, `slot ${p.squadSlot}`);
  assert.ok(g.teams[1].every((p) => p.form === 1), 'the CPU team is unaffected');
  assert.ok(slots.includes(3) && slots.includes(4) && by(3));
});

test('a season ends with a summary; the next season keeps the squad totals, resets the table and raises the difficulty after a title', () => {
  const c = new Career(0, 'easy');
  for (let i = 0; i < 10; i++) play(c, played([3, 0], [{ slot: 4, goals: 1, rating: 7 }]));
  assert.ok(c.tour.over);
  const e = c.endSeason();
  assert.equal(e.pos, 1); assert.equal(e.pts, 30); assert.equal(e.champion, 0); assert.equal(c.seasons.length, 1);
  assert.equal(e.gold.goals >= 10, true); assert.ok(e.pots && e.pots.rating === 7);
  const note = c.nextSeason();
  assert.match(note, /normal/); assert.equal(c.diffKey, 'normal'); assert.equal(c.season, 2);
  assert.deepEqual(c.squad, {}); assert.deepEqual(c.scorers, {}); assert.equal(c.total[4].apps, 10);
  assert.equal(c.tour.round, 0); assert.equal(c.tour.standings()[0].p, 0);
  assert.equal(c.tour.diffKey, 'normal');
  for (let i = 0; i < 10; i++) play(c, played([0, 2]));
  const e2 = c.endSeason(); assert.ok(e2.pos > 1);
  assert.equal(c.nextSeason(), ''); assert.equal(c.diffKey, 'normal', 'no title, no change');
});

test('the career screens render', () => {
  const c = new Career(0, 'normal');
  assert.match(formGuideHtml(c), /No matches/); assert.match(scorersHtml(c), /Nobody/);
  play(c, played([2, 0], [{ slot: 4, goals: 2, rating: 8 }]));
  play(c, played([0, 1], [{ slot: 4, rating: 5, yellows: 1 }]));
  assert.match(formGuideHtml(c), /fg W.*fg L/);
  assert.match(scorersHtml(c), /<b>2<\/b>/);
  assert.match(squadHtml(c), /<table/);
  for (let i = 0; i < 8; i++) play(c, played([1, 0]));
  const e = c.endSeason();
  assert.match(seasonSummaryHtml(e), /champions of season 1/);
  assert.match(seasonsHtml(c), /<table/);
  assert.equal(seasonsHtml(new Career(0, 'normal')), '');
});

test('the league without a career is unchanged: single round robin', () => {
  const t = new Tournament('league', 0, 'normal');
  assert.equal(t.schedule.length, 5);
  const back = Tournament.fromJSON(JSON.parse(JSON.stringify(t)));
  assert.equal(back.round, 0); assert.equal(back.teams.length, 6);
});
