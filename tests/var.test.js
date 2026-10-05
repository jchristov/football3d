import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runUntil, step, startCpuMatch, seedRandom, resetGlobals } from './helpers.js';
import { PITCH, attackDir } from '../src/constants.js';
import { VAR_TIME, VAR_VERDICT } from '../src/rules.js';
import { settings } from '../src/settings.js';

test.beforeEach(() => resetGlobals());

function ready(opts = {}) {
  seedRandom(opts.seed ?? 11);
  const g = makeGame({ var: opts.var ?? true });
  startCpuMatch(g, { length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  step(g, 1);
  return g;
}
// a foul by team 1's player on team 0's player standing at (x, z), with a fixed referee card and fixed VAR dice
function foul(g, { x = 0, z = 3, card = null, ctx = { hadBall: true, fromBehind: true }, rolls } = {}) {
  const f = g.teams[1][2], v = g.teams[0][2];
  g.rules.judgeCard = () => card;
  if (rolls) { const q = [...rolls]; const orig = g.rules.varVerdict.bind(g.rules); g.rules.varVerdict = (a) => orig(a, () => q.shift() ?? 0.99); }
  v.pos.set(x, 0, z);
  g.rules.foul(f, v, ctx);
  return { f, v };
}

test('varVerdict: nothing to check for ordinary fouls and yellow cards; penalties and straight reds are reviewed', () => {
  const g = ready();
  const v = (a, r = () => 0.99) => g.rules.varVerdict(a, r);
  assert.equal(v({ card: null, inBox: false }), null);
  assert.equal(v({ card: 'yellow', inBox: false }), null);
  assert.equal(v({ card: 'second', inBox: false }), null, 'a second yellow is not reviewed');
  assert.ok(v({ card: 'red', inBox: false }).red);
  assert.ok(v({ card: null, inBox: true }).penalty);
  const both = v({ card: 'red', inBox: true });
  assert.ok(both.penalty && both.red);
});

test('varVerdict: contact on the line, soft contact and soft reds are overturned more often than clear fouls', () => {
  const g = ready();
  const rate = (arg, pick, n = 3000) => { let k = 0; for (let i = 0; i < n; i++) if (pick(g.rules.varVerdict(arg))) k++; return k / n; };
  const pen = (r) => r?.penalty?.overturn, red = (r) => r?.red?.overturn;
  const clear = rate({ card: null, inBox: true, margin: 5, ctx: { hadBall: true, fromBehind: true } }, pen);
  const soft = rate({ card: null, inBox: true, margin: 5, ctx: { hadBall: false } }, pen);
  const line = rate({ card: null, inBox: true, margin: 0.2, ctx: { hadBall: true, fromBehind: true } }, pen);
  assert.ok(clear < 0.15 && soft > 0.2 && line > 0.5, `${clear} ${soft} ${line}`);
  const deniedRed = rate({ card: 'red', inBox: false, denied: true }, red), plainRed = rate({ card: 'red', inBox: false }, red);
  assert.ok(deniedRed < plainRed && deniedRed < 0.3 && plainRed > 0.3, `${deniedRed} ${plainRed}`);
  assert.equal(rate({ card: 'red', inBox: false, prior: true }, red), 0, 'a booked player cannot get a lone yellow instead');
});

test('a reviewed red card is shown only after the VAR check, and stands', () => {
  const g = ready();
  const { f } = foul(g, { card: 'red', rolls: [0.99] });
  assert.equal(g.state, 'foul');
  assert.ok(g.rules.pending.review.red);
  assert.equal(g.stats.reds[1], 0, 'no card while the monitor is checked');
  assert.ok(g.hud.varEl.className.includes('check'));
  step(g, VAR_TIME + 0.2);
  assert.equal(g.stats.reds[1], 1, 'the card is shown after the review');
  assert.ok(g.hud.varEl.className.includes('stands'));
  assert.equal(g.rules.varReviews, 1); assert.equal(g.rules.varOverturned, 0);
  runUntil(g, () => g.state === 'setpiece' || g.state === 'playing', VAR_VERDICT + 6);
  assert.ok(f.dead, 'the player is sent off when play restarts');
});

test('an overturned red card becomes a yellow one', () => {
  const g = ready();
  const { f } = foul(g, { card: 'red', rolls: [0.0] });
  step(g, VAR_TIME + 0.2);
  assert.equal(g.stats.reds[1], 0); assert.equal(g.stats.yellows[1], 1);
  assert.ok(g.hud.varEl.className.includes('changed'));
  assert.ok(g.events.some((e) => e.type === 'var' && e.changed));
  runUntil(g, () => g.state === 'setpiece' || g.state === 'playing', VAR_VERDICT + 6);
  assert.ok(!f.dead);
});

test('a penalty that stands is logged after the review; one overturned is a goal kick or a free kick outside the box', () => {
  // team 1 defends its own goal: the box is at the end of the pitch team 0 attacks
  const bx = attackDir(0) * (PITCH.hl - 3);
  let g = ready();
  foul(g, { x: bx, z: 0, rolls: [0.99] });
  assert.equal(g.rules.pending.type, 'penalty');
  assert.ok(!g.events.some((e) => e.type === 'pen'), 'not logged before the verdict');
  step(g, VAR_TIME + 0.2);
  assert.ok(g.events.some((e) => e.type === 'pen'));
  runUntil(g, () => g.state === 'setpiece', VAR_VERDICT + 3);
  assert.equal(g.rules.sp.type, 'penalty');

  g = ready();
  foul(g, { x: bx, z: 0, rolls: [0.0] }); // 3 m inside the box: only the no-foul roll can overturn
  step(g, VAR_TIME + 0.2);
  assert.equal(g.rules.pending.type, 'goalkick');
  assert.equal(g.rules.pending.team, 1, 'the defenders get the goal kick');
  runUntil(g, () => g.state === 'setpiece', VAR_VERDICT + 3);
  assert.equal(g.rules.sp.type, 'goalkick');

  g = ready();
  foul(g, { x: attackDir(0) * (PITCH.hl - 6 * PITCH.s + 0.3), z: 0, rolls: [0.0] }); // 0.3 m inside the line
  step(g, VAR_TIME + 0.2);
  assert.equal(g.rules.pending.type, 'free');
  assert.ok(Math.abs(g.rules.pending.spot.x) < PITCH.hl - 6 * PITCH.s, 'the free kick is taken outside the box');
  assert.equal(g.rules.pending.team, 0);
});

test('VAR can be switched off: the decision is immediate', () => {
  const g = ready({ var: false });
  foul(g, { card: 'red' });
  assert.equal(g.rules.pending.review, null);
  assert.equal(g.stats.reds[1], 1);
  assert.ok(!g.hud.varEl.className.includes('show'));
});

test('no VAR in the penalty shoot-out and for ordinary free kicks', () => {
  const g = ready();
  foul(g, { x: 0, z: 3, card: 'yellow' });
  assert.equal(g.rules.pending.review, null);
  assert.equal(g.stats.yellows[1], 1);
});
