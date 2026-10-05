import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runUntil, step, startCpuMatch, seedRandom, resetGlobals } from './helpers.js';

test.beforeEach(() => resetGlobals());

function ready(seed = 5, over = {}) {
  seedRandom(seed);
  const g = makeGame();
  startCpuMatch(g, { length: 600, ...over });
  runUntil(g, () => g.state === 'playing', 10);
  step(g, 1);
  return g;
}

test('the match log starts empty and is cleared with every match', () => {
  const g = ready();
  assert.deepEqual(g.events, []);
  g.logEvent('pen', 0, { name: 'X' });
  assert.equal(g.events.length, 1);
  startCpuMatch(g, { length: 600 });
  assert.deepEqual(g.events, []);
});

test('there is no log in the menu background match', () => {
  const g = makeGame();
  g.startAttract();
  g.logEvent('goal', 0, { name: 'X' });
  assert.equal(g.events.length, 0);
});

test('goals, cards, substitutions and penalties are logged with the minute and the team', () => {
  const g = ready();
  const f = g.teams[1][3], v = g.teams[0].find((p) => !p.isGK);
  v.pos.set(0, 0, 3);
  g.rules.judgeCard = () => 'yellow';
  g.rules.foul(f, v, { hadBall: true, fromBehind: true });
  assert.equal(g.events.at(-1).type, 'yellow');
  assert.equal(g.events.at(-1).team, 1);
  assert.equal(g.events.at(-1).name, f.name);
  assert.ok(g.events.at(-1).minute >= 1 && g.events.at(-1).minute <= 90);
  runUntil(g, () => g.state === 'playing', 10);
  g.substitute(0, 2, 0);
  const s = g.events.at(-1);
  assert.equal(s.type, 'sub'); assert.equal(s.team, 0); assert.ok(s.inName && s.outName && s.inName !== s.outName);
  // a goal by team 0 (the last toucher is a team-0 player)
  g.ball.reset(0, 0);
  g.ball.lastToucher = g.teams[0][2];
  g.onGoal(0);
  const goal = g.events.at(-1);
  assert.equal(goal.type, 'goal'); assert.equal(goal.team, 0); assert.equal(goal.own, false); assert.equal(goal.name, g.teams[0][2].name);
  g.ball.lastToucher = g.teams[1][2];
  g.state = 'playing';
  g.onGoal(0);
  assert.equal(g.events.at(-1).own, true, 'an own goal is credited to the other side and marked');
});

test('a goal, the red card of a keeper and half time all land in the log', () => {
  const g = ready(7, { length: 60 });
  runUntil(g, () => g.score[0] + g.score[1] > 0 || g.state === 'halftime' || g.state === 'ended', 200);
  if (g.score[0] + g.score[1] > 0) {
    const goal = g.events.find((e) => e.type === 'goal');
    assert.ok(goal && typeof goal.minute === 'number' && goal.name, JSON.stringify(g.events));
  }
  runUntil(g, () => g.state === 'halftime' || g.state === 'ended', 200);
  if (g.state === 'halftime') assert.ok(g.events.some((e) => e.type === 'ht' && e.score.length === 2));
  g.endHalftime?.();
  runUntil(g, () => g.state === 'ended', 200);
  assert.equal(g.events.at(-1).type, 'ft');
  const minutes = g.events.filter((e) => e.minute).map((e) => e.minute);
  assert.deepEqual(minutes, [...minutes].sort((a, b) => a - b), 'events are in chronological order');
});

test('a sent-off keeper is logged together with the replacement keeper', () => {
  const g = ready(9);
  const gk = g.teams[0][0], v = g.teams[1].find((p) => !p.isGK);
  v.pos.set(0, 0, 3);
  g.rules.judgeCard = () => 'red';
  g.rules.foul(gk, v, { hadBall: true, fromBehind: true });
  step(g, 3.5);
  const types = g.events.map((e) => e.type);
  assert.ok(types.includes('red') && types.includes('keeper'), types.join());
});
