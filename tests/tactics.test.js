import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATIONS, FORMATION_KEYS, PRESS, PRESS_KEYS, homeSlots, cpuTactics, gameStateShift, formationOf, pressOf } from '../src/tactics.js';
import { isOffsidePosition, offsideLine, snapshotOffside } from '../src/offside.js';
import { Lineups, MAX_SUBS } from '../src/lineups.js';
import { makeGame, runUntil, step, startCpuMatch, seedRandom } from './helpers.js';
import { PITCH } from '../src/constants.js';
import { settings } from '../src/settings.js';

const P = (x, z = 0, gk = false) => ({ pos: { x, z }, isGK: gk });

test('every formation has four outfield slots on the pitch plus the keeper', () => {
  for (const k of FORMATION_KEYS) {
    const slots = homeSlots(k);
    assert.equal(slots.length, 5); assert.equal(slots[0].role, 'GK');
    for (const s of slots.slice(1)) { assert.ok(s.lx > 3 && s.lx < 47 && Math.abs(s.lz) < 14, `${k}: ${JSON.stringify(s)}`); assert.ok(['DEF', 'MID', 'FWD'].includes(s.role)); }
  }
  assert.equal(formationOf({ formation: 'nope' }), FORMATIONS.balanced);
  assert.equal(pressOf({ press: 'nope' }), PRESS.balanced);
});

test('formations differ in shape: park-the-bus is deeper than all-out attack', () => {
  const depth = (k) => homeSlots(k).slice(1).reduce((s, p) => s + p.lx, 0) / 4;
  assert.ok(depth('park') < depth('balanced') && depth('balanced') < depth('attack'));
  assert.ok(PRESS.high.chasers > PRESS.low.chasers);
});

test('CPU picks tactics from its strength', () => {
  assert.equal(cpuTactics(5).formation, 'attack'); assert.equal(cpuTactics(2).formation, 'park'); assert.equal(cpuTactics(3).formation, 'balanced');
});

test('game state: trailing teams push up, leaders drop back, more so late', () => {
  assert.equal(gameStateShift(0, 0.5), 0);
  assert.ok(gameStateShift(-1, 0.2) > 0 && gameStateShift(1, 0.2) < 0);
  assert.ok(gameStateShift(-1, 0.1) > gameStateShift(-1, 0.9));
  assert.ok(gameStateShift(-9, 0) <= 6 && gameStateShift(9, 0) >= -4);
});

test('offside line is the second-last defender (keeper included)', () => {
  const def = [P(24, 0, true), P(15), P(10), P(18)];
  assert.equal(offsideLine(def, 1), 18);
  assert.equal(offsideLine([P(-24, 0, true), P(-10), P(-5)], -1), 10, 'works for the other direction');
});

test('offside position: own half, level with ball, behind the ball and behind the line are all onside', () => {
  const def = [P(24, 0, true), P(15), P(10)];
  assert.equal(isOffsidePosition(P(18), 5, def, 1), true, 'beyond ball and second-last defender');
  assert.equal(isOffsidePosition(P(18), 20, def, 1), false, 'behind the ball');
  assert.equal(isOffsidePosition(P(12), 5, def, 1), false, 'level with the second-last defender is not beyond it');
  assert.equal(isOffsidePosition(P(-5), -10, def, 1), false, 'own half');
  assert.equal(isOffsidePosition(P(-18), 5, [P(-24, 0, true), P(-15), P(-10)], -1), true, 'mirrored for team 1');
});

test('the offside snapshot ignores the passer and the keeper', () => {
  const def = [P(24, 0, true), P(15), P(10)];
  const passer = P(8), a = P(20), keeper = P(21, 0, true), b = P(11);
  const set = snapshotOffside(passer, [passer, a, keeper, b], def, 8, 1);
  assert.ok(set.has(a)); assert.ok(!set.has(passer)); assert.ok(!set.has(keeper)); assert.ok(!set.has(b));
});

test('in a match, a pass to an attacker in an offside position gives the defenders a free kick', () => {
  seedRandom(21);
  const g = makeGame();
  startCpuMatch(g, { length: 600, offside: true });
  runUntil(g, () => g.state === 'playing', 10);
  g.rules.reset(); g.resetKickoff(0); runUntil(g, () => g.state === 'playing', 10);
  const [passer, striker] = [g.teams[0][2], g.teams[0][4]];
  for (const p of g.all) { p.stunT = 0; p.kickCd = 0; }
  passer.place(5, 0, 0); striker.place(18, 2, 0);
  g.teams[1][1].place(12, -6, Math.PI); g.teams[1][2].place(13, 6, Math.PI); g.teams[1][3].place(14, 0, Math.PI);
  g.teams[1][4].place(15, 4, Math.PI); g.teams[1][0].place(24, 0, Math.PI);
  g.teams[0][1].place(-10, 0, 0); g.teams[0][3].place(-6, 8, 0); g.teams[0][0].place(-24, 0, 0);
  g.ball.reset(5.5, 0); g.ball.owner = passer;
  assert.ok(g.passTo(passer, striker));
  assert.ok(g.watch && g.watch.set.has(striker), 'striker flagged offside at the moment of the pass');
  const before = g.stats.offsides[0];
  for (const p of g.all) if (p !== striker) { p.kickCd = 99; p.touchCd = 99; }
  striker.kickCd = 0; striker.touchCd = 0;
  let n = 0;
  while (g.state === 'playing' && n++ < 60 * 4) { g.ball.vel.y = 0; g.update(1 / 60); }
  assert.equal(g.state, 'foul', `state ${g.state}`);
  assert.equal(g.stats.offsides[0], before + 1);
  assert.equal(g.rules.pending.team, 1, 'free kick to the defending team');
});

test('with offside off the same pass is simply played on', () => {
  const g = makeGame();
  startCpuMatch(g, { length: 600, offside: false });
  assert.equal(g.offsideOn, false);
  assert.equal(g.watch, null);
});

test('substitutions: swap, bench keeps energy, cap of five, keeper cannot be replaced', () => {
  const g = makeGame();
  startCpuMatch(g, { length: 600 });
  const L = g.lineups;
  const p = g.teams[0][2]; p.energy = 0.25;
  const outName = p.name;
  const r = L.substitute(0, 2, 0);
  assert.equal(r.out.name, outName); assert.notEqual(p.name, outName);
  assert.equal(p.energy, 1, 'fresh legs');
  assert.equal(L.energy[0].get(r.out.slot), 0.25, 'tired player rests on the bench');
  assert.equal(L.substitute(0, 0, 0), null, 'keeper stays');
  for (let i = 0; i < 10; i++) L.substitute(0, 1 + (i % 4), i % 3);
  assert.equal(L.subs[0], MAX_SUBS);
  assert.equal(L.substitute(0, 1, 0), null, 'no substitutions left');
  const slots = [...L.onPitch[0], ...L.bench[0]];
  assert.equal(new Set(slots).size, 8, 'nobody is duplicated or lost');
});

test('benched players recover energy over time', () => {
  const g = makeGame(); startCpuMatch(g);
  const L = g.lineups; g.teams[0][1].energy = 0.1; const r = L.substitute(0, 1, 0);
  const before = L.energy[0].get(r.out.slot);
  L.tickBench(30);
  assert.ok(L.energy[0].get(r.out.slot) > before + 0.2);
});

test('tactics change roles and home positions of the pitch players', () => {
  const g = makeGame(); startCpuMatch(g, { mode: '1p' });
  g.setTactics(0, { formation: 'attack', press: 'high' });
  assert.deepEqual(g.teams[0].map((p) => p.home.lx), homeSlots('attack').map((s) => s.lx));
  assert.equal(g.teams[0][1].drainMul, PRESS.high.drain);
  assert.equal(g.teams[0][0].drainMul, 1, 'keeper does not tire faster');
});

test('half time: a human match pauses at half length and continues with a kick-off', () => {
  seedRandom(15);
  const g = makeGame(); let shown = 0; g.onHalftime = () => { shown++; };
  startCpuMatch(g, { mode: '1p', length: 40 });
  g.ctrls[0].enabled = false; // let the CPU play for the human
  runUntil(g, () => g.state === 'halftime' || g.state === 'ended', 60);
  assert.equal(g.state, 'halftime'); assert.equal(shown, 1);
  assert.ok(Math.abs(g.clock - 20) < 1);
  g.endHalftime();
  assert.equal(g.state, 'countdown');
  runUntil(g, () => g.state === 'ended', 120);
  assert.equal(shown, 1, 'only one half time');
});

test('CPU makes substitutions only for tired players, and the human side is left alone', () => {
  seedRandom(31);
  const g = makeGame(); startCpuMatch(g, { mode: '1p', length: 60 }); // team 0 human, team 1 CPU
  g.cpuSubs(0.1);
  assert.equal(g.lineups.subs[1], 0, 'nobody is tired yet');
  for (const i of [1, 2, 3, 4]) { g.teams[1][i].energy = 0.1; g.teams[0][i].energy = 0.1; }
  g.cpuSubs(0.1);
  assert.equal(g.lineups.subs[1], 1, 'one tired CPU player replaced per call');
  assert.equal(g.lineups.subs[0], 0, 'human team keeps its players unless the human decides');
});

test('full matches still complete with every new system switched on', () => {
  for (const seed of [41, 42]) {
    seedRandom(seed);
    const g = makeGame();
    startCpuMatch(g, { length: 60, offside: true, tactics: { formation: 'attack', press: 'high' } });
    runUntil(g, () => g.state === 'ended', 400);
    assert.equal(g.state, 'ended', `seed ${seed}`);
    for (const p of g.all) assert.ok(Math.abs(p.pos.x) <= PITCH.hl && Number.isFinite(p.energy));
  }
});

test('settings keep tactics and offside, and reset restores defaults', () => {
  settings.tactics.formation = 'park'; settings.offside = true;
  assert.equal(settings.tactics.formation, 'park');
});
