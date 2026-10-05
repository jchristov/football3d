import os from 'node:os';
import { WebSocketServer } from 'ws';

export const RELAY_PATH = '/__relay';
const ROOM = /^[A-Z0-9]{4,8}$/;

// A tiny room relay for playing on the same network (or on the same computer): the host opens a room, a friend joins it
// with the code, and every message (text or binary) of one is passed on unchanged to the other. It runs inside the Vite dev /
// preview server, so no extra process is needed; the match data itself is never looked at.
export function attachRelay(httpServer, { path = RELAY_PATH } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const rooms = new Map(); // code -> { host, guest }

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://relay');
    if (url.pathname !== path) return; // other upgrades (the dev server's hot reload) are not ours
    wss.handleUpgrade(req, socket, head, (ws) => join(ws, url));
  });

  function join(ws, url) {
    const code = (url.searchParams.get('room') || '').toUpperCase();
    const role = url.searchParams.get('role');
    if (!ROOM.test(code) || (role !== 'host' && role !== 'guest')) return ws.close(4000, 'bad request');
    let room = rooms.get(code);
    if (role === 'host') {
      if (room) return ws.close(4001, 'room taken');
      room = { host: ws, guest: null };
      rooms.set(code, room);
    } else {
      if (!room) return ws.close(4004, 'no such room');
      if (room.guest) return ws.close(4002, 'room full');
      room.guest = ws;
    }
    const other = () => (room.host === ws ? room.guest : room.host);
    ws.on('message', (data, isBinary) => { const o = other(); if (o && o.readyState === 1 && room.host && room.guest) o.send(data, { binary: isBinary }); });
    ws.on('close', () => {
      const o = other();
      if (rooms.get(code) === room) rooms.delete(code);
      if (o && o.readyState === 1) { try { o.send(JSON.stringify({ t: '$left' })); } catch { /* gone */ } o.close(1000, 'peer left'); }
    });
    ws.on('error', () => ws.close());
    if (room.host && room.guest) for (const s of [room.host, room.guest]) s.send(JSON.stringify({ t: '$ready' }));
  }

  return { wss, rooms, close: () => { for (const c of wss.clients) c.terminate(); wss.close(); } };
}

// The IPv4 addresses of this computer that other devices can use, best first: home / office networks (192.168.x, 10.x, 172.16-31.x)
// before VPN and carrier-grade ranges (100.64.x ...). Loopback and link-local addresses are left out.
export function lanAddresses(ifaces = os.networkInterfaces()) {
  const rank = (a) => (/^(192\.168|10\.)/.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 0 : 1);
  const out = [];
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' && i.family !== 4) continue;
      if (i.internal || i.address.startsWith('169.254.')) continue;
      out.push({ address: i.address, name, rank: rank(i.address) });
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

// Vite plugin: the relay for `vite` and `vite preview`, plus a ping so the game knows that rooms are available
export function relayPlugin() {
  const setup = (server) => {
    attachRelay(server.httpServer);
    // where a friend can reach this game: used to build the QR code when the host opened the game on localhost
    server.middlewares.use(`${RELAY_PATH}/info`, (req, res) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ port: server.httpServer?.address()?.port || null, addresses: lanAddresses() }));
    });
    server.middlewares.use(`${RELAY_PATH}/ping`, (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.end('relay'); });
  };
  return { name: 'fb3d-relay', configureServer: setup, configurePreviewServer: setup };
}
