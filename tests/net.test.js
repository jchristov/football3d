import test from 'node:test';
import assert from 'node:assert/strict';
import { packCode, unpackCode } from '../src/net/codec.js';
import { makeLoopbackPair } from '../src/net/peer.js';
import { HostSession, GuestSession } from '../src/net/session.js';
import { encodeSnapshot, decodeSnapshot, HEADER, STRIDE } from '../src/net/snapshot.js';
import { makeGame, seedRandom, resetGlobals } from './helpers.js';
import { SCHEMES } from '../src/controls.js';

test.beforeEach(() => resetGlobals());

test('invitation codes survive packing and reject garbage', async () => {
  const sdp = 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n' + 'a=candidate:1 1 udp 2113937151 192.168.1.5 54321 typ host\r\n'.repeat(12);
  const code = await packCode({ t: 'offer', sdp });
  assert.match(code, /^FB3D1\.[zr]\.[A-Za-z0-9_-]+$/);
  assert.ok(code.length < sdp.length, 'the code is compressed');
  assert.deepEqual(await unpackCode(`  ${code.slice(0, 20)}\n${code.slice(20)}  `), { t: 'offer', sdp }, 'line breaks and spaces from copy / paste are ignored');
  await assert.rejects(unpackCode('hello'), /not a valid/);
  await assert.rejects(unpackCode(code.slice(0, -12)), /damaged/);
});

// Two games joined by an in-memory link: the host plays, the guest only draws
function pair(seed = 7) {
  seedRandom(seed);
  const host = makeGame(), guest = makeGame();
  const [lh, lg] = makeLoopbackPair();
  const hs = new HostSession(host, lh), gs = new GuestSession(guest, lg);
  const calls = [];
  for (const m of ['setBanner', 'toast', 'showCard', 'showCommentary', 'setEnd']) guest.hud[m] = (...a) => calls.push([m, ...a]);
  const run = (seconds, each) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      host.update(1 / 60); lg.pump(); guest.update(1 / 60); lh.pump();
      if (host.state === 'replay') host.endReplay();
      each?.(i);
    }
  };
  return { host, guest, lh, lg, hs, gs, calls, run };
}
const cfgFor = () => ({ teams: [0, 1], diff: 'normal', length: 120, size: 5, offside: false, env: { time: 'day', weather: 'clear' }, tacticsBy: [{ formation: 'balanced', press: 'balanced' }, { formation: 'twotwo', press: 'high' }] });

test('the guest starts the same match as the host and follows its state', () => {
  const { host, guest, hs, gs, lg, run } = pair();
  hs.start(cfgFor());
  lg.pump();
  assert.equal(guest.remote?.role, 'guest'); assert.equal(host.remote, null);
  assert.equal(guest.mode, '2p'); assert.deepEqual(guest.teamIdx, [0, 1]);
  assert.equal(guest.teams[0].length, 5); assert.equal(guest.lineups.tactics[1].formation, 'twotwo', 'the guest\'s own tactics are used for team 2');
  run(6);
  assert.equal(guest.state, host.state);
  assert.equal(guest.half, host.half); assert.deepEqual(guest.score, host.score);
  assert.ok(Math.abs(guest.clock - host.clock) < 0.2);
  assert.ok(gs.started);
});

test('players and ball on the guest converge to the host positions', () => {
  const { host, guest, run, lg, hs } = pair(11);
  hs.start(cfgFor()); lg.pump();
  run(8);
  // let the guest catch up with the last snapshot
  for (let i = 0; i < 40; i++) { guest.update(1 / 60); }
  for (let i = 0; i < host.roster.length; i++) {
    const a = host.roster[i], b = guest.roster[i];
    assert.ok(Math.hypot(a.mesh.position.x - b.mesh.position.x, a.mesh.position.z - b.mesh.position.z) < 0.35, `player ${i}`);
  }
  assert.ok(Math.hypot(host.ball.mesh.position.x - guest.ball.mesh.position.x, host.ball.mesh.position.z - guest.ball.mesh.position.z) < 0.5);
  assert.ok(Number.isFinite(guest.camera.position.x));
});

test('the guest\'s keys move his player on the host, in the direction of his own screen', () => {
  const { host, guest, run, lg, hs } = pair(3);
  hs.start(cfgFor()); lg.pump();
  run(5);
  assert.equal(host.state, 'playing');
  const c = host.ctrls[1], p0 = c.player, x0 = p0.pos.x, z0 = p0.pos.z;
  for (const code of SCHEMES.solo.right.slice(0, 1)) guest.input.setCode(code, true); // 'D': right on the guest's screen
  run(1.2);
  guest.input.setCode(SCHEMES.solo.right[0], false);
  const p1 = host.ctrls[1].player;
  const f = guest.camForward; // the guest's camera looks along camForward; right = (-fz, fx)
  const moved = { x: p1.pos.x - x0, z: p1.pos.z - z0 };
  const expect = { x: -f.z, z: f.x };
  if (p1 === p0) {
    assert.ok(Math.hypot(moved.x, moved.z) > 1.5, 'he ran');
    assert.ok((moved.x * expect.x + moved.z * expect.z) / Math.hypot(moved.x, moved.z) > 0.8, 'to the right of the guest\'s view');
  }
});

test('shooting, passing and tackling from the guest reach the host controller', () => {
  const { host, guest, run, lg, hs } = pair(5);
  hs.start(cfgFor()); lg.pump();
  run(5);
  const inp = host.input;
  guest.input.setCode(SCHEMES.solo.shoot[0], true);
  run(0.5);
  assert.ok(inp.keys.has('Net:shoot'), 'the held shoot key arrives');
  guest.input.setCode(SCHEMES.solo.shoot[0], false);
  run(0.2);
  assert.ok(!inp.keys.has('Net:shoot'));
  guest.input.setCode(SCHEMES.solo.sprint[0], true);
  run(0.2);
  assert.ok(inp.keys.has('Net:sprint'));
  guest.input.setCode(SCHEMES.solo.sprint[0], false);
  // edges: tackle and switch
  let sawTackle = false, sawSwap = false;
  const orig = inp.consume.bind(inp);
  inp.consume = (...codes) => { const r = orig(...codes); if (r && codes.includes('Net:tackle')) sawTackle = true; if (r && codes.includes('Net:swap')) sawSwap = true; return r; };
  guest.input.tap(SCHEMES.solo.tackle[0]); guest.input.tap(SCHEMES.solo.swap[0]);
  run(0.3);
  assert.ok(sawTackle && sawSwap, 'tackle and switch presses arrive once');
});

test('hud messages, cards, events and the score of the host appear on the guest', () => {
  const { host, guest, run, lg, calls, hs } = pair(21);
  hs.start(cfgFor()); lg.pump();
  run(5);
  const f = host.teams[1][2], v = host.teams[0].find((p) => !p.isGK);
  v.pos.set(0, 0, 3); host.rules.judgeCard = () => 'yellow';
  host.rules.foul(f, v, { hadBall: true, fromBehind: true });
  run(0.3);
  assert.ok(calls.some((c) => c[0] === 'setBanner' && c[1] === 'FOUL!'), 'the FOUL banner');
  assert.ok(calls.some((c) => c[0] === 'showCard' && c[1] === 'yellow'), 'the card');
  assert.ok(calls.some((c) => c[0] === 'showCommentary'), 'commentary');
  assert.equal(guest.events.some((e) => e.type === 'yellow'), true);
  assert.equal(guest.lineups.yellows[1].get(f.squadSlot), 1);
  delete host.rules.judgeCard;
  // a goal
  host.state = 'playing'; host.ball.reset(0, 0); host.ball.lastToucher = host.teams[0][2]; host.onGoal(0);
  run(0.5);
  assert.deepEqual(guest.score, [1, 0]);
  assert.ok(guest.events.some((e) => e.type === 'goal'));
});

test('a sent-off player disappears on the guest as well, and substitutions update the names', () => {
  const { host, guest, run, lg, hs } = pair(9);
  hs.start(cfgFor()); lg.pump();
  run(5);
  const f = host.teams[0][3];
  host.rules.judgeCard = () => 'red';
  const v = host.teams[1].find((p) => !p.isGK); v.pos.set(0, 0, 3);
  host.rules.foul(f, v, { hadBall: true, fromBehind: true });
  run(4);
  delete host.rules.judgeCard;
  assert.equal(host.teams[0].length, 4);
  assert.equal(guest.teams[0].length, 4, 'the guest sees only four players');
  assert.equal(guest.pool[0][f.index].mesh.visible, false);
  const before = host.teams[1][2].name;
  host.substitute(1, 2, 0);
  run(0.5);
  assert.equal(guest.pool[1][2].name, host.pool[1][2].name);
  assert.notEqual(guest.pool[1][2].name, before);
});

test('the host\'s pause is shown on the guest; the guest cannot pause', () => {
  const { host, guest, run, lg, hs } = pair(4);
  hs.start(cfgFor()); lg.pump();
  run(5);
  host.togglePause();
  run(0.5);
  assert.equal(guest.state, 'paused');
  guest.togglePause();
  assert.equal(guest.state, 'paused', 'unchanged (and not toggled locally)');
  host.togglePause();
  run(0.5);
  assert.equal(guest.state, host.state);
});

test('when the guest leaves, the CPU takes over his team and the match goes on', () => {
  const { host, guest, run, lg, lh, hs } = pair(6);
  hs.start(cfgFor()); lg.pump();
  run(4);
  lg.close();
  assert.equal(hs.gone, true);
  assert.equal(host.ctrls[1].enabled, false);
  assert.equal(host.aiControlled(1), true);
  const x = host.teams[1][1].pos.x;
  for (let i = 0; i < 300; i++) host.update(1 / 60);
  for (const p of host.all) assert.ok(Number.isFinite(p.pos.x));
  assert.notEqual(host.state, 'ended');
});

test('a snapshot has a fixed size and decodes back to the same state', () => {
  const { host, run, lg, hs } = pair(2);
  hs.start(cfgFor()); lg.pump();
  run(3);
  const a = encodeSnapshot(host, 5);
  assert.equal(a.length, HEADER + host.roster.length * STRIDE);
  assert.ok(a.byteLength < 4000, `${a.byteLength} bytes`);
  const s = decodeSnapshot(a.buffer);
  assert.equal(s.state, host.state); assert.equal(s.n, host.roster.length);
  assert.ok(Math.abs(s.ball.x - host.ball.mesh.position.x) < 1e-4);
  assert.equal(decodeSnapshot(new Float32Array(10)), null, 'garbage is ignored');
});

test('snapshots that arrive late or twice are dropped', () => {
  const { host, guest, run, lg, gs, hs } = pair(8);
  hs.start(cfgFor()); lg.pump();
  run(2);
  const n = gs.buf.length;
  gs.onSnapshot(encodeSnapshot(host, 1)); // an old sequence number
  assert.equal(gs.buf.length, n);
  gs.onSnapshot(new Float32Array(3)); // garbage
  assert.equal(gs.buf.length, n);
});
