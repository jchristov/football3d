import { PeerLink } from './peer.js';
import { RelayLink, makeRoomCode } from './relay.js';
import { HostSession, GuestSession } from './session.js';
import { settings, saveSettings } from '../settings.js';
import { qrSvg, shareBases, joinLink, inviteLink, parseShareLink } from './share.js';

const $ = (id) => document.getElementById(id);
const HINT = 'No direct connection could be made. Tick "Internet play" on BOTH computers if you are not on the same network, switch off VPNs, then create a new invitation and start again (every invitation works only once).';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The "Online match" panel: connect two browsers directly (WebRTC) by exchanging two codes by hand, no server needed.
export class NetUI {
  constructor(game, menu) {
    this.game = game; this.menu = menu;
    this.root = $('netPanel');
    this.tab = 'host';
    this.relay = false; // the game server offers rooms (dev / preview server)
    this.roomCode = '';
    this.info = null; // { port, addresses } of the computer that runs the game server (for the QR code)
    this.addrIdx = 0;
    this.ready = RelayLink.available().then(async (ok) => {
      this.relay = ok;
      if (ok) this.info = await RelayLink.info();
      if (ok && !this.connected) this.tab = 'room';
      if (this.open) this.render();
      this.menu.refresh?.();
    });
    this.link = null; this.session = null;
    this.role = null; // 'host' | 'guest' once chosen
    this.text = { offer: '', reply: '', invite: '', answer: '' };
    this.status = { kind: 'idle', msg: '' };
    this.busy = false;
    this.replyUsed = false; this.timer = null;
    window.addEventListener('keydown', (e) => { if (this.open && e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.hide(); } }, true);
  }

  get open() { return !this.root.classList.contains('hidden'); }
  get connected() { return !!this.session && this.link?.isOpen; }
  get isGuest() { return this.connected && this.role === 'guest'; }
  get isHost() { return this.connected && this.role === 'host'; }

  show() { this.render(); this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setStatus(kind, msg) { this.status = { kind, msg }; if (this.open) this.renderStatus(); this.menu.refresh?.(); }

  reset() {
    clearTimeout(this.timer); this.timer = null; this.replyUsed = false;
    this.session?.dispose(); this.session = null;
    this.link?.close(); this.link = null;
    this.role = null; this.text = { offer: '', reply: '', invite: '', answer: '' };
    document.body.classList.remove('net-guest');
    this.setStatus('idle', '');
    if (this.open) this.render();
  }

  newLink() {
    const link = new PeerLink({ stun: !!settings.netStun });
    this.link = link;
    link.onstate = (s) => {
      if (link !== this.link) return;
      if (s === 'failed') this.setStatus('error', HINT);
    };
    return link;
  }

  async guard(fn) {
    if (this.busy) return;
    this.busy = true; this.render();
    try { await fn(); } catch (e) { this.setStatus('error', e.message || String(e)); }
    this.busy = false; if (this.open) this.render();
  }

  // ----- room (same network / same computer, through the game server) -----
  createRoom() {
    return this.guard(async () => {
      this.reset();
      this.role = 'host';
      this.roomCode = makeRoomCode();
      const link = this.link = new RelayLink();
      link.onopen = () => this.opened(link);
      link.onclose = () => this.closed();
      link.onerror = (e) => this.setStatus('error', e.message);
      link.open(this.roomCode, 'host');
      this.setStatus('wait', `Room ${this.roomCode} is open. Your friend joins it with this code.`);
    });
  }

  joinRoom(given) {
    const code = (given || $('netRoom')?.value || '').trim().toUpperCase();
    return this.guard(async () => {
      this.reset();
      if (!/^[A-Z0-9]{4,8}$/.test(code)) throw new Error('Type the room code of the host (4 letters or digits).');
      this.role = 'guest';
      this.roomCode = code;
      const link = this.link = new RelayLink();
      link.onopen = () => this.opened(link);
      link.onclose = () => this.closed();
      link.onerror = (e) => this.setStatus('error', e.message);
      link.open(code, 'guest');
      this.setStatus('wait', `Joining room ${code}…`);
    });
  }

  // ----- sharing by link / QR code -----
  // Where the friend can reach this game (the choices matter on localhost: then it is one of this computer's network addresses)
  bases() { return shareBases(location, this.info); }
  base() { const b = this.bases(); return b[Math.min(this.addrIdx, b.length - 1)]?.base || ''; }

  // The share box: QR code, the link and copy / share buttons. `link` is null when there is no address a friend could use.
  shareBox(link, what) {
    if (!link) return `<p class="hint">⚠ The game runs on <b>localhost</b> and no network address was found, so a friend cannot open it from another device. Connect to a network, or open the game with its network address.</p>`;
    let svg = '';
    try { svg = qrSvg(link); } catch { /* too long for a QR code: the link still works */ }
    const bases = this.bases();
    const modules = Number(/viewBox="0 0 (\d+)/.exec(svg)?.[1] || 0), px = Math.min(340, Math.max(170, modules * 4)); // dense codes need a bigger picture
    return `<div class="net-share">${svg ? `<div class="net-qr" style="width:${px}px;height:${px}px" title="Scan with the phone camera">${svg}</div>` : ''}
      <div class="net-sharetext"><p class="hint">${svg ? `Scan this with the camera of a phone: it opens the game and ${what}.` : `Send this link: it opens the game and ${what}.`}</p>
        <input id="netLink" class="net-linkbox" readonly value="${esc(link)}" />
        <div class="row left"><button id="netCopyLink">Copy link</button>${navigator.share ? '<button id="netShare">Share…</button>' : ''}</div>
        ${bases.length > 1 ? `<label class="hint">Address: <select id="netAddr">${bases.map((b, i) => `<option value="${i}" ${i === this.addrIdx ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select></label>` : ''}
      </div></div>`;
  }

  copyLink() {
    const el = $('netLink'); if (!el) return;
    el.select();
    (navigator.clipboard?.writeText(el.value) || Promise.reject()).catch(() => document.execCommand?.('copy'));
    this.setStatus(this.status.kind, this.status.msg.replace(/ \(link copied\)$/, '') + ' (link copied)');
  }

  // A link or QR code was opened (?join=CODE or #invite=CODE): go to the online panel and start joining at once
  async openFromLink(href = location.href) {
    const req = parseShareLink(href);
    if (!req) return false;
    try { history.replaceState(null, '', location.pathname); } catch { /* not allowed here */ }
    this.menu.sel.mode = 'online'; this.menu.refresh?.();
    if (req.room) {
      await this.ready;
      this.tab = 'room'; this.show();
      if (!this.relay) { this.setStatus('error', 'This game server has no rooms. Ask the host for an invitation code instead.'); return true; }
      await this.joinRoom(req.room);
    } else {
      this.tab = 'join'; this.text.invite = req.invite; this.show();
      await this.createReply(req.invite);
    }
    return true;
  }

  // ----- host -----
  createInvitation() {
    return this.guard(async () => {
      this.reset();
      this.role = 'host';
      const link = this.newLink();
      this.setStatus('wait', 'Creating the invitation…');
      this.text.offer = await link.createInvitation();
      link.onopen = () => this.opened(link);
      link.onclose = () => this.closed();
      this.setStatus('wait', 'Send the invitation to your friend, then paste their reply below.');
    });
  }

  acceptReply() {
    const code = $('netReply').value; // read before guard() redraws the panel
    this.text.reply = code;
    return this.guard(async () => {
      await this.link.acceptReply(code);
      this.replyUsed = true;
      this.setStatus('wait', 'Connecting… (this can take a few seconds)');
      this.watch();
    });
  }

  // If the direct connection does not open, say what to try instead of waiting for ever
  watch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (!this.connected) this.setStatus('error', HINT); }, 15000);
  }

  // ----- guest -----
  createReply(given) {
    const code = given || $('netInvite').value; // read before guard() redraws the panel
    return this.guard(async () => {
      this.reset();
      this.role = 'guest';
      this.text.invite = code;
      const link = this.newLink();
      this.setStatus('wait', 'Reading the invitation…');
      this.text.answer = await link.acceptInvitation(code);
      link.onopen = () => this.opened(link);
      link.onclose = () => this.closed();
      this.setStatus('wait', 'Send this reply back to the host and wait for the connection.');
      this.watch();
    });
  }

  // ----- both -----
  opened(link) {
    if (link !== this.link) return;
    clearTimeout(this.timer);
    const g = this.game;
    if (this.role === 'host') {
      this.session = new HostSession(g, link);
      this.session.onguest = () => this.menu.refresh?.();
      this.session.ondrop = () => this.closed();
      this.setStatus('ok', 'Your friend is connected! Pick the teams in the menu and kick off.');
    } else {
      const s = this.session = new GuestSession(g, link);
      s.onstart = () => { document.body.classList.add('net-guest'); this.hide(); };
      s.onstop = () => { document.body.classList.remove('net-guest'); this.menu.toMenu?.(); };
      s.ondrop = () => this.closed();
      s.hello(settings.tactics);
      this.setStatus('ok', 'Connected! Waiting for the host to start the match…');
    }
  }

  closed() {
    if (!this.link && !this.session) return;
    const was = this.role;
    const g = this.game;
    this.session?.dispose(); this.session = null; this.link?.close(); this.link = null; this.role = null;
    document.body.classList.remove('net-guest');
    if (was === 'guest' && g.remote) { g.remote = null; g.hud.toast?.('The host left the game', 2500); this.menu.toMenu?.(); }
    this.setStatus('idle', was ? 'The connection was closed.' : '');
    if (this.open) this.render();
  }

  copy(id) {
    const el = $(id);
    el.select();
    (navigator.clipboard?.writeText(el.value) || Promise.reject()).catch(() => document.execCommand?.('copy'));
    this.setStatus(this.status.kind, `${this.status.msg} (copied)`.replace(/ \(copied\) \(copied\)/, ' (copied)'));
  }

  renderStatus() {
    const el = $('netStatus');
    if (!el) return;
    const icon = { idle: '', wait: '⏳', ok: '✅', error: '⚠️' }[this.status.kind] || '';
    el.className = `net-status ${this.status.kind}`;
    el.textContent = this.status.msg ? `${icon} ${this.status.msg}` : '';
  }

  render() {
    const t = this.tab, live = this.connected;
    const area = (id, value, ro, ph) => `<textarea id="${id}" rows="4" spellcheck="false" ${ro ? 'readonly' : ''} placeholder="${esc(ph || '')}">${esc(value)}</textarea>`;
    const host = `
      <ol class="net-steps">
        <li>Create the invitation and send it to your friend (chat, mail …).
          <div class="row left"><button id="netCreate" ${this.busy ? 'disabled' : ''}>Create invitation</button>${this.text.offer ? '<button id="netCopyOffer">Copy</button>' : ''}</div>
          ${this.text.offer ? area('netOffer', this.text.offer, true) : ''}
          ${this.text.offer && this.base() ? this.shareBox(inviteLink(this.base(), this.text.offer), 'fills in the invitation') : ''}</li>
        <li>Paste your friend's reply here.
          ${area('netReply', this.text.reply, false, 'FB3D1.z.…')}
          <div class="row left"><button id="netConnect" class="primary" ${this.busy || !this.text.offer || this.replyUsed ? 'disabled' : ''}>${this.replyUsed ? 'Connecting…' : 'Connect'}</button>${this.replyUsed && !this.connected ? '<button id="netAgain">Create a new invitation</button>' : ''}</div></li>
      </ol>`;
    const room = `
      <div class="net-room">
        <p>Same network or same computer: no codes to swap. ${this.relay ? '' : '<b>Rooms are not available here</b> (they need the game to run from <code>npm run dev</code> or <code>npm run preview</code>).'}</p>
        <div class="net-cols">
          <div><h4>Host</h4><button id="netCreateRoom" class="primary" ${this.busy || !this.relay ? 'disabled' : ''}>Create a room</button>
            ${this.role === 'host' && this.roomCode ? `<div class="net-code">${esc(this.roomCode)}</div>${this.shareBox(this.base() && joinLink(this.base(), this.roomCode), 'joins the room')}<p class="hint">Or your friend opens the game on the same network and types the code.</p>` : ''}</div>
          <div><h4>Join</h4><input id="netRoom" maxlength="8" placeholder="CODE" value="${esc(this.role === 'guest' ? this.roomCode : '')}" autocomplete="off" spellcheck="false" />
            <button id="netJoinRoom" class="primary" ${this.busy || !this.relay ? 'disabled' : ''}>Join room</button></div>
        </div>
      </div>`;
    const guest = `
      <ol class="net-steps">
        <li>Paste the invitation of the host here.
          ${area('netInvite', this.text.invite, false, 'FB3D1.z.…')}
          <div class="row left"><button id="netMakeReply" class="primary" ${this.busy ? 'disabled' : ''}>Create reply</button></div></li>
        <li>Send this reply back to the host and wait.
          ${this.text.answer ? `${area('netAnswer', this.text.answer, true)}<div class="row left"><button id="netCopyAnswer">Copy</button></div>` : '<p class="hint">The reply appears here.</p>'}</li>
      </ol>`;
    this.root.innerHTML = `<div class="panel wide net">
      <h2>Online match</h2>
      <p class="tag">Peer to peer: the two browsers talk directly, there is no server. You swap two short codes by hand.</p>
      <div class="row net-tabs">
        <button id="netTabRoom" class="${t === 'room' ? 'on' : ''}">Room (same network)</button>
        <button id="netTabHost" class="${t === 'host' ? 'on' : ''}">Host with codes</button>
        <button id="netTabJoin" class="${t === 'join' ? 'on' : ''}">Join with codes</button>
      </div>
      <div class="net-body">${t === 'room' ? room : t === 'host' ? host : guest}</div>
      ${t === 'room' ? '' : `<div class="set-opts"><label><input type="checkbox" id="netStun" ${settings.netStun ? 'checked' : ''}> Internet play (uses a public STUN server to find your address; same network works without)</label></div>`}
      <div id="netStatus" class="net-status"></div>
      <div class="hint">The host runs the match and picks the teams, length and rules in the menu. You control one player each: same keys as in the single-player game. Latency is felt a little by the guest.</div>
      <div class="row">${live ? '<button id="netDisconnect">Disconnect</button>' : ''}<button id="netClose" class="primary">${live ? 'Done' : 'Close'}</button></div>
    </div>`;
    this.renderStatus();
    this.bind();
  }

  bind() {
    $('netTabRoom').onclick = () => { this.tab = 'room'; this.render(); };
    $('netTabHost').onclick = () => { this.tab = 'host'; this.render(); };
    $('netTabJoin').onclick = () => { this.tab = 'join'; this.render(); };
    $('netClose').onclick = () => this.hide();
    if ($('netStun')) $('netStun').onchange = (e) => { settings.netStun = e.target.checked; saveSettings(); };
    if ($('netCreateRoom')) $('netCreateRoom').onclick = () => this.createRoom();
    if ($('netJoinRoom')) $('netJoinRoom').onclick = () => this.joinRoom();
    if ($('netRoom')) $('netRoom').onkeydown = (e) => { if (e.code === 'Enter') { e.stopPropagation(); this.joinRoom(); } };
    if ($('netDisconnect')) $('netDisconnect').onclick = () => { this.reset(); };
    if ($('netCreate')) $('netCreate').onclick = () => this.createInvitation();
    if ($('netConnect')) $('netConnect').onclick = () => this.acceptReply();
    if ($('netAgain')) $('netAgain').onclick = () => this.createInvitation();
    if ($('netMakeReply')) $('netMakeReply').onclick = () => this.createReply();
    if ($('netCopyLink')) $('netCopyLink').onclick = () => this.copyLink();
    if ($('netShare')) $('netShare').onclick = () => navigator.share({ title: 'Turbo Football 3D', text: 'Join my match!', url: $('netLink').value }).catch(() => {});
    if ($('netAddr')) $('netAddr').onchange = (e) => { this.addrIdx = Number(e.target.value); this.render(); };
    if ($('netLink')) $('netLink').onfocus = (e) => e.target.select();
    if ($('netCopyOffer')) $('netCopyOffer').onclick = () => this.copy('netOffer');
    if ($('netCopyAnswer')) $('netCopyAnswer').onclick = () => this.copy('netAnswer');
  }
}
