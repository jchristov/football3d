import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, startCpuMatch, runUntil, step, seedRandom, resetGlobals } from './helpers.js';

test.beforeEach(() => resetGlobals());

test('goals, cards, substitutions, kick-off, half time and full time are announced', () => {
  seedRandom(14);
  const g = makeGame();
  const said = [];
  g.speech = { speak() {}, stop() {}, announce: (t) => { said.push(t); return true; } };
  g.comm.enabled = false; // the announcer does not depend on the commentary caption
  startCpuMatch(g, { length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  assert.ok(said.some((t) => /welcome/i.test(t) && t.includes(g.teamName(0)) && /captain number \d+/.test(t)), said.join(' | '));
  g.ball.reset(0, 0); g.ball.lastToucher = g.teams[0][2]; g.state = 'playing'; g.onGoal(0);
  assert.ok(said.some((t) => /^Goal for/.test(t) && t.includes(g.teams[0][2].name.toLowerCase().replace(/^./, (c) => c.toUpperCase())) && /1, /.test(t)), said.join(' | '));
  g.substitute(0, 2, 0);
  assert.ok(said.some((t) => /^Substitution for/.test(t) && /replaces number/.test(t)));
  g.state = 'playing';
  g.rules.judgeCard = () => 'yellow';
  const v = g.teams[1].find((p) => !p.isGK); v.pos.set(0, 0, 3);
  g.rules.foul(g.teams[0][3], v, { hadBall: true, fromBehind: true });
  assert.ok(said.some((t) => /^Yellow card for number/.test(t)));
  delete g.rules.judgeCard;
  g.comm.halftime([1, 0]);
  assert.ok(said.some((t) => /^Half time\./.test(t)));
  g.comm.fullTime('Blue win.');
  assert.ok(said.some((t) => /^Full time\./.test(t)));
});

test('nothing is announced in the menu background match', () => {
  const g = makeGame();
  const said = [];
  g.speech = { speak() {}, stop() {}, announce: (t) => said.push(t) };
  g.startAttract();
  g.comm.announce('should not be said');
  assert.equal(said.length, 0);
});
