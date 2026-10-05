import test from 'node:test';
import assert from 'node:assert/strict';
import { aptitude, tackleChance, outOfPosition, OUT_OF_POSITION } from '../src/skills.js';
import { specialityFor } from '../src/teams.js';
import { makeGame, startCpuMatch, seedRandom, resetGlobals, runUntil, step } from './helpers.js';

test.beforeEach(() => resetGlobals());

const P = (role, spec = specialityFor(0, 3, role), pos = role) => ({ spec, role: pos, isGK: false });

test('aptitude follows the speciality: strong in an area = better there, weak = worse', () => {
  const def = P('DEF'), att = P('FWD'), mid = P('MID');
  assert.ok(aptitude(def, 'def') > aptitude(att, 'def'));
  assert.ok(aptitude(att, 'att') > aptitude(def, 'att'));
  assert.ok(aptitude(mid, 'mid') > aptitude(def, 'mid') && aptitude(mid, 'mid') > aptitude(att, 'mid'));
  for (const p of [def, att, mid]) for (const a of ['def', 'mid', 'att']) assert.ok(aptitude(p, a) > 0.8 && aptitude(p, a) < 1.15, `${a} ${aptitude(p, a)}`);
});

test('goalkeepers and players without a speciality are neutral', () => {
  assert.equal(aptitude({ spec: { gk: 100, main: 'GK' }, role: 'GK', isGK: true }, 'def'), 1);
  assert.equal(aptitude({}, 'att'), 1);
  assert.equal(outOfPosition({ spec: { gk: 100, main: 'GK' }, role: 'GK', isGK: true }), false);
});

test('playing outside the natural role costs 6%', () => {
  const home = P('DEF'), away = P('DEF', home.spec, 'FWD');
  assert.equal(outOfPosition(home), false); assert.equal(outOfPosition(away), true);
  assert.ok(Math.abs(aptitude(away, 'def') / aptitude(home, 'def') - OUT_OF_POSITION) < 1e-9);
});

test('defenders win slide tackles against attackers more often than attackers win them against defenders', () => {
  const d = P('DEF'), f = P('FWD');
  assert.ok(tackleChance(d, f) > tackleChance(f, d));
  assert.ok(tackleChance(d, f) > 0.9, `${tackleChance(d, f)}`);
  assert.ok(tackleChance(f, d) >= 0.45 && tackleChance(f, d) < 0.85, `${tackleChance(f, d)}`);
});

test('shots are harder for attackers, passes more accurate for midfielders (game integration)', () => {
  seedRandom(77);
  const g = makeGame();
  startCpuMatch(g, { length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  const atk = g.teams[0].find((p) => p.spec.main === 'FWD'), def = g.teams[0].find((p) => p.spec.main === 'DEF');
  const power = (p) => { g.ball.reset(p.pos.x + 0.5, p.pos.z); p.kickCd = 0; g.doKick(p, 0, 20, 0.1, 0, 'shot'); return g.ball.speed; };
  const sa = power(atk), sd = power(def);
  assert.ok(sa > sd, `striker ${sa} vs defender ${sd}`);
  // pass error spread
  const spread = (p) => {
    let sum = 0;
    const target = g.teams[0][2] === p ? g.teams[0][3] : g.teams[0][2];
    for (let i = 0; i < 400; i++) {
      p.pos.set(-10, 0, 0); target.pos.set(10, 0, 0); target.vel.set(0, 0, 0);
      g.ball.reset(-9.5, 0); g.ball.owner = p; p.kickCd = 0; p.stunT = 0; p.lungeT = 0;
      g.passTo(p, target, 0.7);
      sum += Math.abs(Math.atan2(g.ball.vel.z, g.ball.vel.x));
    }
    return sum / 400;
  };
  const mid = g.teams[0].find((p) => p.spec.main === 'MID'), fwd = atk;
  assert.ok(spread(mid) < spread(fwd), 'a midfielder passes more accurately');
});

test('the full simulation still runs normally with the skills in place', () => {
  seedRandom(5);
  const g = makeGame();
  startCpuMatch(g, { length: 90 });
  runUntil(g, () => g.state === 'ended' || g.state === 'halftime', 120);
  if (g.state === 'halftime') g.endHalftime();
  runUntil(g, () => g.state === 'ended', 200);
  assert.equal(g.state, 'ended');
  assert.ok(g.stats.tackles[0] + g.stats.tackles[1] > 0 || g.stats.passes[0] > 0);
});
