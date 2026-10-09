import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFS, DIFF_KEYS, REACH, BALL } from '../src/constants.js';
import { makeDiff, TEAMS } from '../src/teams.js';
import { Career } from '../src/career.js';
import { cleanMenuChoices } from '../src/menu.js';
import { makeGame, startCpuMatch, runUntil, step, seedRandom, resetGlobals } from './helpers.js';
import { CAMERA_LABEL } from '../src/game.js';
import { settings } from '../src/settings.js';

test.beforeEach(() => resetGlobals());

test('there are six levels from Kids to Expert, ordered from the weakest to the strongest CPU', () => {
  assert.deepEqual(DIFF_KEYS, ['kids', 'beginner', 'easy', 'normal', 'hard', 'expert']);
  for (let i = 1; i < DIFF_KEYS.length; i++) {
    const a = DIFFS[DIFF_KEYS[i - 1]], b = DIFFS[DIFF_KEYS[i]];
    assert.ok(b.speed > a.speed && b.react < a.react && b.save > a.save && b.shootRange > a.shootRange && b.aim < a.aim && b.tackle > a.tackle, `${DIFF_KEYS[i]} is stronger than ${DIFF_KEYS[i - 1]}`);
    assert.ok(b.assist <= a.assist, 'only the easy levels help the player');
  }
  for (const k of DIFF_KEYS) assert.ok(DIFFS[k].label && DIFFS[k].blurb);
  assert.equal(DIFFS.normal.assist, 0); assert.equal(DIFFS.hard.assist, 0);
});

test('the old levels are unchanged and the team rating still shifts the CPU within sane limits', () => {
  assert.equal(DIFFS.normal.speed, 0.92); assert.equal(DIFFS.hard.react, 0.16); assert.equal(DIFFS.normal.save, 0.58);
  for (const k of DIFF_KEYS) for (const r of [1, 3, 5]) {
    const d = makeDiff(k, r);
    assert.ok(d.speed > 0.4 && d.speed < 1.2 && d.react >= 0.08 && d.save > 0 && d.save <= 0.92 && d.tackle >= 0 && d.tackle <= 0.9, `${k}/${r} ${JSON.stringify(d)}`);
  }
  assert.ok(makeDiff('kids', 1).speed < makeDiff('kids', 5).speed);
  assert.equal(makeDiff('nonsense', 3).speed, makeDiff('normal', 3).speed, 'an unknown level is Normal');
});

test('the menu accepts every level and the career raises the level one step after a title', () => {
  for (const k of DIFF_KEYS) assert.equal(cleanMenuChoices({ diff: k }).diff, k);
  assert.equal(cleanMenuChoices({ diff: 'impossible' }).diff, 'normal');
  const c = new Career(0, 'beginner');
  for (let i = 0; i < 10; i++) { const opp = c.tour.userFixture.opponent; c.recordMatch({ score: [3, 0], ratings: [] }, opp); c.tour.report({ score: [3, 0], winner: 0 }); }
  c.endSeason();
  assert.match(c.nextSeason(), /easy/); assert.equal(c.diffKey, 'easy');
});

test('the low levels help the human team to get the ball; the CPU never gets help', () => {
  const touches = (diff) => {
    seedRandom(7);
    const g = makeGame();
    g.startMatch({ mode: '1p', teams: [0, 1], diff, length: 120, knockout: false, env: { time: 'day', weather: 'clear' } });
    return g;
  };
  assert.deepEqual(touches('kids').humanAssist, [0.5, 0]);
  assert.deepEqual(touches('beginner').humanAssist, [0.35, 0]);
  assert.deepEqual(touches('normal').humanAssist, [0, 0]);
  assert.deepEqual(touches('expert').humanAssist, [0, 0]);
  const g = makeGame(); g.startMatch({ mode: '2p', teams: [0, 1], diff: 'kids', length: 60, knockout: false, env: { time: 'day', weather: 'clear' } });
  assert.deepEqual(g.humanAssist, [0, 0], 'no help in a 2-player match');
});

test('a ball just out of reach is picked up on Kids but not on Normal', () => {
  const trial = (diff) => {
    seedRandom(3);
    const g = makeGame();
    g.startMatch({ mode: '1p', teams: [0, 1], diff, length: 120, knockout: false, env: { time: 'day', weather: 'clear' } });
    runUntil(g, () => g.state === 'playing', 10); step(g, 0.5);
    const p = g.ctrls[0].player;
    for (const o of g.all) if (o !== p) o.pos.set(o.pos.x, 0, o.pos.z + 40); // everybody else far away
    p.place(-5, 0, 0); p.touchCd = 0; p.kickCd = 0;
    const reach = REACH * (0.7 + BALL.r);
    g.ball.reset(-5 + reach * 1.25, 0); // 25% beyond the normal reach
    g.contacts();
    return g.ball.owner === p;
  };
  assert.equal(trial('kids'), true); assert.equal(trial('normal'), false);
});

test('C cycles broadcast, selected player, ball and bird\'s-eye; 2-player has no selected-player camera', () => {
  const g = makeGame();
  startCpuMatch(g, { mode: '1p', length: 60 });
  assert.deepEqual(g.camModes, ['broadcast', 'follow', 'ball', 'top']);
  g.camMode = 0; settings.camera = 'broadcast';
  const seen = [];
  for (let i = 0; i < 5; i++) { g.nextCamera(); seen.push(g.camModes[g.camMode]); }
  assert.deepEqual(seen, ['follow', 'ball', 'top', 'broadcast', 'follow']);
  assert.equal(settings.camera, 'follow');
  g.startMatch({ mode: '2p', teams: [0, 1], diff: 'normal', length: 60, knockout: false, env: { time: 'day', weather: 'clear' } });
  assert.deepEqual(g.camModes, ['broadcast', 'ball', 'top']);
  for (const k of ['broadcast', 'follow', 'ball', 'top']) assert.ok(CAMERA_LABEL[k]);
});

test('the ball camera follows the ball, the follow camera the selected player', () => {
  const g = makeGame();
  startCpuMatch(g, { mode: '1p', length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  const p = g.ctrls[0].player;
  const aim = (mode) => { g.camMode = g.camModes.indexOf(mode); for (let i = 0; i < 400; i++) g.updateCamera(1 / 60); return g.camLook.clone(); };
  p.place(-12, 6, 0); g.ball.reset(15, -5);
  const lookBall = aim('ball'), lookFollow = aim('follow');
  assert.ok(lookBall.x > 15 && lookBall.x < 25, `looks ahead of the ball: ${lookBall.x}`);
  assert.ok(lookFollow.x < 0, `looks around the player: ${lookFollow.x}`);
  assert.ok(Math.abs(lookBall.z - -5 * 0.8) < 1);
});

test('CPU toughness has five levels, defaults to a weaker CPU than before and scales the opponent', async () => {
  const { CPU_TOUGHNESS, clampToughness } = await import('../src/settings.js');
  assert.equal(CPU_TOUGHNESS.length, 5);
  assert.equal(settings.cpuToughness, 2);
  assert.equal(clampToughness(9), 5); assert.equal(clampToughness(-1), 1); assert.equal(clampToughness('x'), 2);
  for (let t = 2; t <= 5; t++) {
    const a = makeDiff('normal', 3, t - 1), b = makeDiff('normal', 3, t);
    assert.ok(b.speed > a.speed && b.react < a.react && b.save > a.save && b.tackle > a.tackle && b.aim < a.aim);
  }
  assert.deepEqual(makeDiff('normal', 3, 3), makeDiff('normal', 3), 'level 3 is the previous behaviour');
  const g = makeGame();
  settings.cpuToughness = 1;
  g.startMatch({ mode: '1p', teams: [0, 1], diff: 'normal', length: 60, knockout: false, env: { time: 'day', weather: 'clear' } });
  const weak = g.aiDiff[1].speed;
  settings.cpuToughness = 5;
  g.startMatch({ mode: '1p', teams: [0, 1], diff: 'normal', length: 60, knockout: false, env: { time: 'day', weather: 'clear' } });
  assert.ok(g.aiDiff[1].speed > weak);
});
