// The same interface as PeerLink, but over the game server's room relay (server/relay.js): for playing on one network or on
// one computer, where a direct WebRTC connection may be blocked (VPNs, strict routers).
const CODES = { 4000: 'The room code is not valid.', 4001: 'This room code is already in use. Create a new room.', 4002: 'This room already has two players.', 4004: 'There is no room with this code (yet). Check the code and that the host has created the room.' };

export const makeRoomCode = () => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); };

export class RelayLink {
  constructor({ base = typeof location !== 'undefined' ? location.href : 'http://localhost/', WS = typeof WebSocket !== 'undefined' ? WebSocket : null } = {}) {
    this.base = base; this.WS = WS;
    this.ws = null; this.state = 'new'; this.role = null; this.room = '';
    this.onopen = () => {}; this.onclose = () => {}; this.onmessage = () => {}; this.onfast = () => {}; this.onstate = () => {}; this.onerror = () => {};
  }

  static async available(base = typeof location !== 'undefined' ? location.href : '', fetchFn = typeof fetch !== 'undefined' ? fetch : null) {
    try { const r = await fetchFn(new URL('__relay/ping', base), { cache: 'no-store' }); return r.ok && (await r.text()).trim() === 'relay'; } catch { return false; }
  }

  // The network addresses of the computer that runs the game server ({ port, addresses }), or null
  static async info(base = typeof location !== 'undefined' ? location.href : '', fetchFn = typeof fetch !== 'undefined' ? fetch : null) {
    try { const r = await fetchFn(new URL('__relay/info', base), { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
  }

  _setState(s) { if (this.state !== s) { this.state = s; this.onstate(s); } }
  get isOpen() { return this.state === 'open'; }

  // Connect to the room as 'host' or 'guest'; the link opens (onopen) when both players are in
  open(room, role) {
    this.room = room; this.role = role;
    const url = new URL('__relay', this.base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = new URLSearchParams({ room, role }).toString();
    const ws = (this.ws = new this.WS(url.toString()));
    ws.binaryType = 'arraybuffer';
    this._setState('waiting');
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') { this.onfast(e.data); return; }
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === '$ready') { this._setState('open'); this.onopen(); } else if (m.t === '$left') { this._left(); } else this.onmessage(m);
    };
    ws.onclose = (e) => {
      if (this.state === 'open') this._left();
      else if (this.state === 'waiting') { this._setState('failed'); this.onerror(new Error(CODES[e.code] || 'The connection to the game server was closed.')); }
    };
    ws.onerror = () => { if (this.state === 'waiting') { this._setState('failed'); this.onerror(new Error('Cannot reach the game server. Is the game running from `npm run dev`?')); } };
  }

  _left() { if (this.state === 'closed') return; this._setState('closed'); this.onclose(); }
  send(obj) { if (this.isOpen && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  sendFast(buf) {
    if (!this.isOpen || this.ws.readyState !== 1) return;
    this.ws.send(ArrayBuffer.isView(buf) ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
  }
  close() { try { this.ws?.close(); } catch { /* closed */ } if (this.state !== 'closed') this._setState('closed'); }
}
