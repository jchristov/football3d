import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { qrSvg, isLoopback, shareBases, joinLink, inviteLink, parseShareLink } from '../src/net/share.js';
import { lanAddresses, relayPlugin } from '../server/relay.js';
import { RelayLink } from '../src/net/relay.js';

test('a QR code is an SVG with a quiet zone, in a version that fits the text', () => {
  const s = qrSvg('http://192.168.1.109:5100/?join=ABCD');
  assert.match(s, /^<svg [^>]*viewBox="0 0 (\d+) \1"/);
  const n = Number(/viewBox="0 0 (\d+)/.exec(s)[1]);
  assert.ok(n >= 29 + 4 && n < 60, `size ${n}`); // version 3 is 29 modules, plus 2 x 2 for the quiet zone
  assert.match(s, /<rect [^>]*fill="#fff"/); assert.match(s, /<path d="M\d+ \d+h1v1h-1z/);
  const bigger = Number(/viewBox="0 0 (\d+)/.exec(qrSvg('x'.repeat(900)))[1]);
  assert.ok(bigger > n);
  assert.throws(() => qrSvg('x'.repeat(4000)), /too long/);
  assert.equal(qrSvg('same'), qrSvg('same'), 'deterministic');
});

test('loopback hosts are recognised', () => {
  for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1']) assert.ok(isLoopback(h), h);
  for (const h of ['192.168.1.5', 'example.com', '']) assert.ok(!isLoopback(h), h);
});

test('the share address: the page address when it can be reached, else the network addresses of the server computer', () => {
  const info = { port: 5100, addresses: [{ address: '192.168.1.109' }, { address: '100.64.0.1' }] };
  assert.deepEqual(shareBases({ href: 'http://localhost:5100/?x=1#y' }, info).map((b) => b.base), ['http://192.168.1.109:5100/', 'http://100.64.0.1:5100/']);
  assert.deepEqual(shareBases({ href: 'https://games.example.com/football/?join=ABCD' }, info), [{ label: 'games.example.com', base: 'https://games.example.com/football/' }]);
  assert.deepEqual(shareBases({ href: 'http://localhost:5100/play/' }, { port: 5100, addresses: [{ address: '10.0.0.7' }] }).map((b) => b.base), ['http://10.0.0.7:5100/play/']);
  assert.deepEqual(shareBases({ href: 'http://localhost:5100/' }, null), [], 'no address known');
});

test('join and invitation links round-trip', () => {
  const j = joinLink('http://192.168.1.109:5100/', 'abcd');
  assert.equal(j, 'http://192.168.1.109:5100/?join=abcd');
  assert.deepEqual(parseShareLink(j), { room: 'ABCD' });
  const code = 'FB3D1.z.AbC-_09';
  const i = inviteLink('http://host/game/?old=1', code);
  assert.equal(i, `http://host/game/#invite=${code}`);
  assert.deepEqual(parseShareLink(i), { invite: code });
  for (const bad of ['http://x/', 'http://x/?join=no', 'http://x/?join=<script>', 'http://x/#invite=evil', 'http://x/#invite=FB3D1.q.abc', 'not a url', '']) assert.equal(parseShareLink(bad), null, bad);
});

test('the server lists the addresses of this computer: home networks first, no loopback, no link-local', () => {
  const list = lanAddresses({
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    utun3: [{ family: 'IPv4', address: '100.64.0.1', internal: false }],
    en0: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '192.168.1.109', internal: false }],
    en1: [{ family: 4, address: '169.254.3.3', internal: false }, { family: 4, address: '172.20.1.2', internal: false }],
  });
  assert.deepEqual(list.map((a) => a.address), ['192.168.1.109', '172.20.1.2', '100.64.0.1']);
  assert.deepEqual(lanAddresses({}), []);
});

test('the game server reports its port and addresses at /__relay/info', async () => {
  const handlers = [];
  const srv = http.createServer((req, res) => {
    const h = handlers.find((x) => req.url.startsWith(x.path));
    if (h) { req.url = req.url.slice(h.path.length) || '/'; h.fn(req, res); } else { res.statusCode = 404; res.end(); }
  });
  const plugin = relayPlugin();
  plugin.configureServer({ httpServer: srv, middlewares: { use: (path, fn) => handlers.push({ path, fn }) } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const info = await RelayLink.info(base);
  assert.equal(info.port, srv.address().port); assert.ok(Array.isArray(info.addresses));
  assert.equal(await RelayLink.info('http://127.0.0.1:1/'), null, 'no server');
  srv.closeAllConnections?.(); srv.close();
});
