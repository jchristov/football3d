import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { attachRelay, relayPlugin } from '../server/relay.js';
import { RelayLink, makeRoomCode } from '../src/net/relay.js';
import { HostSession, GuestSession } from '../src/net/session.js';
import { makeGame, seedRandom, resetGlobals } from './helpers.js';
import { SCHEMES } from '../src/controls.js';

const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 3000) { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await sleep(5); return cond(); }

async function server() {
  const srv = http.createServer((req, res) => { if (req.url.startsWith('/__relay/ping')) { res.end('relay'); } else { res.statusCode = 404; res.end('no'); } });
  const relay = attachRelay(srv);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  return { srv, relay, base, stop: () => { relay.close(); srv.close(); } };
}
const links = (base) => { const a = new RelayLink({ base }), b = new RelayLink({ base }); return [a, b]; };

test('room codes are four easy-to-read characters', () => {
  for (let i = 0; i < 50; i++) assert.match(makeRoomCode(), /^[A-HJKMNP-Z2-9]{4}$/);
});

test('the game can tell whether the server offers rooms', async () => {
  const s = await server();
  assert.equal(await RelayLink.available(s.base), true);
  assert.equal(await RelayLink.available('http://127.0.0.1:1/'), false, 'no server at all');
  s.stop();
});

test('host and guest meet in a room; text and binary messages arrive unchanged', async () => {
  const s = await server();
  const [host, guest] = links(s.base);
  const got = { ctl: [], fast: [] };
  guest.onmessage = (m) => got.ctl.push(m); host.onfast = (b) => got.fast.push(new Float32Array(b));
  let opened = 0; host.onopen = () => opened++; guest.onopen = () => opened++;
  host.open('ABCD', 'host');
  await sleep(50);
  assert.equal(opened, 0, 'the host waits for the friend');
  guest.open('ABCD', 'guest');
  assert.ok(await until(() => opened === 2));
  assert.equal(host.isOpen && guest.isOpen, true);
  host.send({ t: 'hello', n: 5 });
  guest.sendFast(new Float32Array([1, 2.5, -3]));
  assert.ok(await until(() => got.ctl.length === 1 && got.fast.length === 1));
  assert.deepEqual(got.ctl[0], { t: 'hello', n: 5 });
  assert.deepEqual([...got.fast[0]], [1, 2.5, -3]);
  host.close(); guest.close(); s.stop();
});

test('clear errors for a missing room, a taken code and a full room', async () => {
  const s = await server();
  const [h1, g1] = links(s.base);
  const err = (l) => new Promise((res) => { l.onerror = (e) => res(e.message); });
  const lost = err(g1); g1.open('NOPE', 'guest');
  assert.match(await lost, /no room with this code/);
  h1.open('ROOM', 'host'); await sleep(30);
  const h2 = new RelayLink({ base: s.base }); const taken = err(h2); h2.open('ROOM', 'host');
  assert.match(await taken, /already in use/);
  const g2 = new RelayLink({ base: s.base }); g2.open('ROOM', 'guest'); await until(() => g2.isOpen);
  const g3 = new RelayLink({ base: s.base }); const full = err(g3); g3.open('ROOM', 'guest');
  assert.match(await full, /two players/);
  const bad = new RelayLink({ base: s.base }); const e4 = err(bad); bad.open('x', 'host');
  assert.match(await e4, /not valid/);
  for (const l of [h1, g1, h2, g2, g3, bad]) l.close();
  s.stop();
});

test('when one player leaves the other is told and the room is freed', async () => {
  const s = await server();
  const [host, guest] = links(s.base);
  let hostClosed = 0; host.onclose = () => hostClosed++;
  host.open('LEAV', 'host'); guest.open('LEAV', 'guest');
  await until(() => host.isOpen && guest.isOpen);
  guest.close();
  assert.ok(await until(() => hostClosed === 1));
  assert.equal(s.relay.rooms.size, 0);
  const again = new RelayLink({ base: s.base }); again.open('LEAV', 'host');
  assert.ok(await until(() => s.relay.rooms.has('LEAV')), 'the code can be used again');
  again.close(); host.close(); s.stop();
});

test('the Vite plugin serves the relay and a ping', async () => {
  const srv = http.createServer(); const routes = {};
  const plugin = relayPlugin();
  plugin.configureServer({ httpServer: srv, middlewares: { use: (p, fn) => { routes[p] = fn; } } });
  assert.ok(routes['/__relay/ping']);
  let body = ''; routes['/__relay/ping']({}, { setHeader() {}, end: (b) => { body = b; } });
  assert.equal(body, 'relay');
  assert.equal(srv.listenerCount('upgrade'), 1);
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});

test('a complete online match over real sockets: the guest follows the host and steers his player', async () => {
  resetGlobals(); seedRandom(12);
  const s = await server();
  const host = makeGame(), guest = makeGame();
  const [lh, lg] = links(s.base);
  let opened = 0; lh.onopen = () => opened++; lg.onopen = () => opened++;
  lh.open('GAME', 'host'); lg.open('GAME', 'guest');
  assert.ok(await until(() => opened === 2));
  const hs = new HostSession(host, lh), gs = new GuestSession(guest, lg);
  hs.start({ teams: [0, 1], diff: 'normal', length: 120, size: 5, offside: false, env: { time: 'day', weather: 'clear' }, tacticsBy: [{ formation: 'balanced', press: 'balanced' }, { formation: 'balanced', press: 'balanced' }] });
  assert.ok(await until(() => guest.remote?.role === 'guest' && gs.started));
  guest.input.setCode(SCHEMES.solo.right[0], true);
  for (let i = 0; i < 360; i++) { host.update(1 / 60); guest.update(1 / 60); await sleep(2); if (host.state === 'replay') host.endReplay(); }
  assert.equal(guest.state, host.state);
  assert.ok(Math.abs(guest.clock - host.clock) < 0.5);
  assert.ok(gs.buf.length >= 2, 'snapshots keep coming');
  assert.ok(hs.remote.bits & (1 << 7), "the guest's key reached the host");
  lh.close(); lg.close(); s.stop();
});
