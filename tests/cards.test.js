import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runUntil, step, startCpuMatch, seedRandom, resetGlobals } from './helpers.js';
import { PITCH, TEAM_SIZES } from '../src/constants.js';

test.beforeEach(() => resetGlobals());

function ready(size = 5, seed = 11, over = {}) {
  seedRandom(seed);
  const g = makeGame();
  startCpuMatch(g, { length: 600, size, ...over });
  runUntil(g, () => g.state === 'playing', 10);
  step(g, 1);
  return g;
}
// make the next foul by `fouler` end with the given card, then let the foul play out
function foulWith(g, fouler, kind) {
  g.rules.judgeCard = () => kind;
  const victim = g.teams[1 - fouler.team].find((p) => !p.isGK);
  victim.pos.set(0, 0, 3);
  g.rules.foul(fouler, victim, { hadBall: true, fromBehind: true });
}

test('the referee mixes free kicks, yellow and red cards; reckless fouls are punished harder', () => {
  const g = ready();
  const f = g.teams[0][2], v = g.teams[1][2];
  const count = (ctx, n = 4000) => {
    const c = { none: 0, yellow: 0, second: 0, red: 0 };
    for (let i = 0; i < n; i++) { g.lineups.yellows[0].clear(); g.lineups.fouls[0].clear(); g.lineups.fouls[0].set(f.squadSlot, 1); c[g.rules.judgeCard(f, v, ctx) || 'none']++; }
    return c;
  };
  v.pos.set(0, 0, 0);
  const mild = count({ hadBall: false, fromBehind: false, inBox: false });
  const rough = count({ hadBall: true, fromBehind: true, inBox: true });
  assert.ok(mild.none > mild.yellow && mild.yellow > 0 && mild.red > 0, JSON.stringify(mild));
  assert.ok(rough.yellow > mild.yellow && rough.red > mild.red, `${JSON.stringify(rough)} vs ${JSON.stringify(mild)}`);
});

test('a last-man foul on a run at goal is mostly a red card', () => {
  const g = ready();
  const f = g.teams[1][2], v = g.teams[0][2];
  v.pos.set(PITCH.hl - 6, 0, 0); // team 0 attacks towards +x
  g.lineups.fouls[1].set(f.squadSlot, 1);
  let reds = 0; for (let i = 0; i < 1000; i++) if (g.rules.judgeCard(f, v, { hadBall: true, fromBehind: true, inBox: false }) === 'red') reds++;
  assert.ok(reds > 150, `${reds} reds out of 1000`);
});

test('a yellow card is recorded, shown on the player and counted; a second one is a red card', () => {
  const g = ready();
  const f = g.teams[1][3];
  foulWith(g, f, 'yellow');
  assert.equal(f.yellows, 1);
  assert.equal(g.lineups.yellowsOf(1, f.squadSlot), 1);
  assert.deepEqual(g.stats.yellows, [0, 1]);
  assert.equal(g.all.length, 10, 'nobody has left the pitch yet');
  step(g, 3.5);
  assert.equal(g.teams[1].length, 5);
  // the second yellow: now sent off
  runUntil(g, () => g.state === 'playing', 10);
  foulWith(g, f, 'second');
  assert.deepEqual(g.stats.yellows, [0, 2]); assert.deepEqual(g.stats.reds, [0, 1]);
  assert.ok(g.teams[1].includes(f), 'still on the pitch until play restarts');
  step(g, 3.5);
  assert.ok(!g.teams[1].includes(f));
  assert.equal(g.teams[1].length, 4);
  assert.equal(g.lineups.playersOn(1), 4);
});

test('a sent-off player leaves for good: hidden, no longer in play, cannot be substituted, team stays a man down', () => {
  const g = ready(7);
  const f = g.teams[0][4];
  const slot = f.squadSlot;
  foulWith(g, f, 'red');
  step(g, 3.5);
  assert.equal(f.dead, true); assert.equal(f.mesh.visible, false);
  assert.equal(g.teams[0].length, 6); assert.equal(g.all.length, 13);
  assert.equal(g.pool[0].length >= 7, true);
  assert.ok(g.lineups.sentOff[0].has(slot));
  assert.equal(g.lineups.substitute(0, f.index, 0), null, 'the empty slot cannot be filled');
  assert.equal(g.lineups.canSendOff(0), true);
  // the other players keep their formation positions and the match carries on
  runUntil(g, () => g.state === 'playing', 10);
  step(g, 20);
  for (const p of g.all) assert.ok(Number.isFinite(p.pos.x) && Math.abs(p.pos.x) <= PITCH.hl && Math.abs(p.pos.z) <= PITCH.hw);
  // a bench player can still replace a different player
  assert.ok(g.lineups.substitute(0, 1, 0));
  // the next kick-off has one player fewer
  g.resetKickoff(1);
  assert.equal(g.teams[0].length, 6);
  assert.equal(g.pool[0].filter((p) => p.mesh.visible).length, 6);
});

test('a sent-off goalkeeper is replaced in goal by an outfield player; the keeper kit stays on the keeper slot', () => {
  const g = ready(5);
  const gk = g.teams[0][0], lastIdx = 4, nm = g.lineups.member(0, lastIdx).name, gkName = g.lineups.member(0, 0).name;
  foulWith(g, gk, 'red');
  step(g, 3.5);
  assert.equal(g.teams[0].length, 4);
  assert.equal(g.teams[0][0].isGK, true);
  assert.equal(g.teams[0][0].name, nm, 'the former forward is in goal now');
  assert.ok(g.pool[0][lastIdx].dead && g.lineups.dead[0].has(lastIdx));
  assert.equal(g.lineups.member(0, lastIdx).name, gkName, 'the sent-off keeper is the one shown as sent off');
  step(g, 15);
  assert.ok(Number.isFinite(g.teams[0][0].pos.x));
});

test('a team is never reduced below its minimum: later reds are only yellows', () => {
  for (const n of TEAM_SIZES) {
    const g = ready(n, 20 + n);
    const L = g.lineups;
    let sent = 0;
    for (let i = 0; i < n; i++) {
      runUntil(g, () => g.state === 'playing', 10);
      const f = g.teams[0].find((p) => !p.isGK);
      L.yellows[0].set(f.squadSlot, 1); // already booked: the next card is a second yellow
      const v = g.teams[1].find((p) => !p.isGK); v.pos.set(0, 0, 3);
      g.rules.judgeCard = (ff) => (L.canSendOff(ff.team) ? 'second' : 'yellow');
      g.rules.foul(f, v, {});
      step(g, 3.5);
      if (f.dead) sent++;
    }
    assert.equal(L.playersOn(0), L.minPlayers(), `${n}-a-side stays at ${L.minPlayers()}`);
    assert.equal(sent, n - L.minPlayers());
  }
});

test('the real judgeCard never sends a player off below the minimum', () => {
  const g = ready(5);
  const L = g.lineups;
  L.dead[0].add(3); // pretend two are already off: 5 -> 3 = minimum
  L.dead[0].add(2);
  const f = g.teams[0][1], v = g.teams[1][2];
  v.pos.set(PITCH.hl - 4, 0, 0);
  for (let i = 0; i < 500; i++) { L.yellows[0].set(f.squadSlot, i % 2); assert.ok(['yellow', null].includes(g.rules.judgeCard(f, v, { hadBall: true, fromBehind: true, inBox: true }))); }
});

test('booked players tackle more carefully (AI) and cards reset with every match', () => {
  const g = ready(5);
  const f = g.teams[0][2];
  foulWith(g, f, 'yellow');
  assert.equal(f.yellows, 1);
  startCpuMatch(g, { length: 600, size: 5 });
  assert.equal(g.pool[0][2].yellows, 0);
  assert.deepEqual(g.stats.yellows, [0, 0]);
  assert.equal(g.lineups.sentOff[0].size, 0);
});

test('full matches with a lot of cards still finish at every team size (replays included)', () => {
  for (const n of TEAM_SIZES) {
    seedRandom(300 + n);
    const g = makeGame();
    startCpuMatch(g, { length: 90, size: n });
    g.rules.judgeCard = (f) => (g.lineups.canSendOff(f.team) && Math.random() < 0.6 ? 'red' : 'yellow');
    runUntil(g, () => g.state === 'ended' || g.state === 'halftime', 120);
    if (g.state === 'halftime') g.endHalftime();
    runUntil(g, () => g.state === 'ended', 200);
    assert.equal(g.state, 'ended', `${n}-a-side finished`);
    for (const t of [0, 1]) assert.ok(g.lineups.playersOn(t) >= g.lineups.minPlayers());
    for (const p of g.all) assert.ok(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z));
  }
});

test('the card tally appears in the match statistics', () => {
  const g = ready();
  assert.ok(!g.stats.rows([0, 0]).some((r) => /card/i.test(r[0])));
  foulWith(g, g.teams[1][3], 'yellow');
  const rows = g.stats.rows([1, 1]);
  assert.deepEqual(rows.find((r) => r[0] === 'Yellow cards').slice(1, 3), [0, 1]);
});
