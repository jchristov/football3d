import { Controller, SCHEMES } from '../controls.js';
import { encodeSnapshot, decodeSnapshot, applySnapshot } from './snapshot.js';
import { setBallSize, SIDES } from '../constants.js';
import { settings } from '../settings.js';

const SEND_HZ = 30;
const DELAY = 0.1; // the guest shows the match this far in the past so that it can blend between snapshots
const SFX = ['kick', 'bounce', 'post', 'save', 'tackle', 'whistle', 'finalWhistle', 'cheer', 'ooh', 'groan'];
const HUD = ['setBanner', 'hideBanner', 'toast', 'showCard', 'hideCard', 'showVar', 'hideVar', 'showCommentary', 'setPens', 'setEnd', 'showEnd', 'showPause', 'showReplay'];
const SPEECH = ['speak', 'announce', 'stop'];
const ACTIONS = ['sprint', 'shoot', 'curl', 'pass', 'up', 'down', 'left', 'right']; // bit i of the input packet
const NET_CODE = (a) => `Net:${a}`;

// Replace methods of `obj` by versions that also report the call; returns the function that undoes it
function tap(obj, names, report) {
  const undo = [];
  for (const m of names) {
    if (!obj || typeof obj[m] !== 'function') continue;
    const had = Object.prototype.hasOwnProperty.call(obj, m), orig = obj[m];
    obj[m] = function (...a) { report(m, a); return orig.apply(this, a); };
    undo.push(() => { if (had) obj[m] = orig; else delete obj[m]; });
  }
  return () => undo.forEach((f) => f());
}

const pickStats = (g) => ({ poss: g.stats.poss, shots: g.stats.shots, onTarget: g.stats.onTarget, passes: g.stats.passes, passesOk: g.stats.passesOk, saves: g.stats.saves, tackles: g.stats.tackles, headers: g.stats.headers, offsides: g.stats.offsides, corners: g.stats.corners, yellows: g.stats.yellows, reds: g.stats.reds, fouls: g.rules.fouls, offsideOn: g.offsideOn, heat: g.stats.heat.map((a) => Array.from(a, (v) => Math.round(v * 10) / 10)), shotLog: g.stats.shotLog, pairs: [...g.stats.pairs], players: [...g.stats.players.values()] });

// The host runs the whole match; the friend's controls reach it as 'Net:*' keys through a RemoteController.
export class HostSession {
  constructor(game, link) {
    this.role = 'host';
    this.game = game; this.link = link;
    this.seq = 0; this.acc = 0;
    this.remote = { mx: 0, mz: 0, l: 0, bits: 0, swap: 0, tackle: 0 };
    this.guestTactics = null;
    this.dirtyIdent = true; this.dirtyMeta = true; this.metaVersion = -1; this.metaAcc = 0;
    this.onguest = () => {}; this.ondrop = () => {};
    this.undo = [];
    link.onmessage = (m) => this.onMessage(m);
    link.onfast = (buf) => this.onInput(buf);
    link.onclose = () => this.dropped();
    this.hook();
  }

  hook() {
    const g = this.game, send = (kind) => (m, a) => this.link.send({ t: kind, m, a });
    this.undo.push(tap(g.hud, HUD, send('hud')));
    this.undo.push(tap(g.sfx, SFX, send('sfx')));
    this.undo.push(tap(g.speech, SPEECH, send('speech')));
    this.undo.push(tap(g.world?.confetti, ['burst'], send('confetti')));
    this.undo.push(tap(g.hud, ['renderStats'], (m, [id]) => this.link.send({ t: 'stats', id, stats: pickStats(g) })));
    this.undo.push(tap(g.hud, ['renderRatings'], () => this.link.send({ t: 'ratings', ratings: g.ratings, motm: g.motm })));
    this.undo.push(tap(g.hud, ['renderScorers'], (m, [goals]) => this.link.send({ t: 'scorers', goals: (goals || []).map((x) => ({ team: x.team, name: x.name, minute: x.minute, own: x.own })) })));
    this.undo.push(tap(g.lineups, ['applyIdentities'], () => { this.dirtyIdent = true; }));
  }

  onMessage(m) {
    if (m.t === 'hello') { this.guestTactics = m.tactics || null; this.onguest(m); }
    else if (m.t === 'bye') this.dropped();
  }

  // Inputs from the guest: [seq, moveX, moveZ, magnitude, action bits, swap counter, tackle counter]
  onInput(buf) {
    const a = buf instanceof Float32Array ? buf : new Float32Array(buf);
    if (a.length < 7) return;
    const r = this.remote;
    r.mx = a[1]; r.mz = a[2]; r.l = a[3]; r.bits = a[4] | 0;
    if (a[5] !== r.swap) { r.swapTap = (r.swapTap || 0) + 1; r.swap = a[5]; }
    if (a[6] !== r.tackle) { r.tackleTap = (r.tackleTap || 0) + 1; r.tackle = a[6]; }
  }

  dropped() {
    if (this.gone) return;
    this.gone = true;
    const c = this.game.ctrls[1];
    if (c && this.game.net === this) { c.enabled = false; c.reset?.(); this.game.hud.toast?.('Your friend left: the CPU takes over', 2500); }
    this.ondrop();
  }

  // Everything the guest needs to start the same match
  startCfg(cfg) {
    return { teams: cfg.teams, size: cfg.size, length: cfg.length, offside: cfg.offside, env: cfg.env, tactics: cfg.tacticsBy, knockout: false, ballFace: this.game.ball.face, ballSize: settings.ballSize, swapHalves: settings.swapHalves !== false };
  }

  start(cfg) {
    const g = this.game;
    cfg = { ...cfg, mode: '2p', net: { role: 'host' }, tacticsBy: cfg.tacticsBy };
    cfg.tactics = cfg.tacticsBy;
    this.gone = false;
    g.net = this;
    g.startMatch(cfg);
    this.link.send({ t: 'start', cfg: { ...this.startCfg(cfg), ballFace: g.ball.face } });
    this.dirtyIdent = true; this.dirtyMeta = true; this.metaVersion = -1;
    this.flush();
  }

  // before the simulation step: the friend's keys
  preUpdate() {
    const g = this.game, r = this.remote, inp = g.input, c = g.ctrls[1];
    if (!c || !c.enabled || !(c instanceof Object) || !('mv' in c)) return;
    c.mv = { dx: r.mx, dz: r.mz, l: r.l };
    ACTIONS.forEach((a, i) => inp.setCode(NET_CODE(a), !!(r.bits & (1 << i))));
    if (r.swapTap) { inp.tap(NET_CODE('swap')); r.swapTap = 0; }
    if (r.tackleTap) { inp.tap(NET_CODE('tackle')); r.tackleTap = 0; }
  }

  postUpdate(dt) {
    this.acc += dt; this.metaAcc += dt;
    this.flush();
    if (this.acc >= 1 / SEND_HZ) {
      this.acc %= 1 / SEND_HZ;
      this.link.sendFast(encodeSnapshot(this.game, ++this.seq));
    }
  }

  // identities of the players on the pitch, discipline and the events log
  flush() {
    const g = this.game, L = g.lineups;
    if (this.dirtyIdent) {
      this.dirtyIdent = false;
      this.link.send({
        t: 'ident',
        teams: [0, 1].map((t) => g.pool[t].slice(0, L.size).map((p) => { const m = L.member(t, p.index); return { slot: m.slot, id: m.id, num: m.num, name: m.name, look: m.look, captain: p.index === L.captainPitchIndex(t), role: p.role, spec: m.spec }; })),
      });
      this.dirtyMeta = true;
    }
    if (this.dirtyMeta || g.eventsVersion !== this.metaVersion) {
      this.dirtyMeta = false; this.metaVersion = g.eventsVersion;
      this.link.send({ t: 'meta', events: g.events, version: g.eventsVersion, yellows: L.yellows.map((m) => [...m]), sentOff: L.sentOff.map((s) => [...s]) });
    }
  }

  // The match is over or abandoned (back to the menu, another kind of match): tell the guest
  matchEnded() {
    this.link.send({ t: 'stop' });
    if (this.game.net === this) this.game.net = null;
  }

  dispose() {
    this.undo.forEach((f) => f()); this.undo = [];
    if (this.game.net === this) this.game.net = null;
    this.link.onmessage = this.link.onfast = this.link.onclose = () => {};
  }
}

// The guest does not simulate anything: it sends its controls and draws what the host reports.
export class GuestSession {
  constructor(game, link) {
    this.role = 'guest';
    this.game = game; this.link = link;
    this.buf = [];
    this.seq = 0; this.acc = 0; this.swap = 0; this.tackle = 0;
    this.sampler = null;
    this.onstart = () => {}; this.onstop = () => {}; this.ondrop = () => {}; this.started = false;
    link.onmessage = (m) => this.onMessage(m);
    link.onfast = (b) => this.onSnapshot(b);
    link.onclose = () => this.dropped();
  }

  hello(tactics) { this.link.send({ t: 'hello', tactics }); }

  dropped() { if (this.gone) return; this.gone = true; this.ondrop(); }

  onMessage(m) {
    const g = this.game;
    switch (m.t) {
      case 'start': this.begin(m.cfg); break;
      case 'ident': this.applyIdent(m.teams); break;
      case 'meta':
        g.events = m.events || []; g.eventsVersion = m.version;
        m.yellows.forEach((e, t) => { g.lineups.yellows[t] = new Map(e); });
        m.sentOff.forEach((e, t) => { g.lineups.sentOff[t] = new Set(e); });
        break;
      case 'hud': g.hud[m.m]?.(...m.a); break;
      case 'sfx': g.sfx[m.m]?.(...m.a); break;
      case 'speech': g.speech?.[m.m]?.(...m.a); break;
      case 'confetti': g.world?.confetti?.burst?.(...m.a); break;
      case 'stats': this.applyStats(m); break;
      case 'ratings': g.ratings = m.ratings; g.motm = m.motm; g.hud.renderRatings?.(g); break;
      case 'scorers': g.hud.renderScorers?.(m.goals); break;
      case 'stop': this.game.remote = null; if (this.game.net === this) this.game.net = null; this.onstop(); break;
      case 'bye': this.dropped(); break;
      default: break;
    }
  }

  applyStats(m) {
    const g = this.game, s = m.stats;
    for (const k of ['poss', 'shots', 'onTarget', 'passes', 'passesOk', 'saves', 'tackles', 'headers', 'offsides', 'corners', 'yellows', 'reds']) if (s[k]) g.stats[k] = s[k];
    g.rules.fouls = s.fouls || [0, 0];
    g.offsideOn = !!s.offsideOn;
    if (s.heat) { g.stats.heat = s.heat.map((a) => Float32Array.from(a)); g.stats.shotLog = s.shotLog || []; g.stats.pairs = new Map(s.pairs || []); g.stats.players = new Map((s.players || []).map((r) => [r.key, r])); }
    g.hud.renderStats?.(m.id, g);
    if (m.id === 'endStats') g.hud.renderAnalysis?.(g);
  }

  begin(cfg) {
    const g = this.game;
    this.buf = []; this.started = true; this.gone = false;
    setBallSize(cfg.ballSize || 5);
    this.swapHalves = cfg.swapHalves !== false;
    g.net = this;
    g.startMatch({ ...cfg, mode: '2p', net: { role: 'guest' }, onEnd: null });
    if (cfg.ballFace) g.ball.show?.(cfg.ballFace);
    this.sampler = new Controller(g, 1, 'solo'); // reads the guest's own keys and camera
    this.onstart(cfg);
  }

  // The host's names, numbers and looks (the guest may have edited squads differently)
  applyIdent(teams) {
    const g = this.game;
    teams.forEach((list, t) => list.forEach((m, i) => {
      const p = g.pool[t][i];
      if (!p) return;
      p.setIdentity(m.num, m.name, m.look, m.captain, m.id);
      p.squadSlot = m.slot; p.spec = m.spec; p.role = m.role;
    }));
  }

  onSnapshot(buf) {
    const s = decodeSnapshot(buf);
    if (!s) return;
    s.at = this.game.time;
    const last = this.buf[this.buf.length - 1];
    if (last && s.seq <= last.seq) return; // late or duplicated
    this.buf.push(s);
    if (this.buf.length > 12) this.buf.shift();
  }

  // Called every frame by Game.updateRemote
  tick(dt) {
    const g = this.game;
    this.pollEdges();
    this.acc += dt;
    if (this.acc >= 1 / SEND_HZ) { this.acc %= 1 / SEND_HZ; this.sendInput(); }
    if (!this.buf.length) return;
    const rt = g.time - DELAY;
    let a = this.buf[0], b = this.buf[0], t = 0;
    for (let i = 0; i < this.buf.length; i++) {
      if (this.buf[i].at <= rt) a = b = this.buf[i];
      else { b = this.buf[i]; if (a.at < rt) t = (rt - a.at) / Math.max(1e-4, b.at - a.at); break; }
    }
    const newest = this.buf[this.buf.length - 1];
    applySnapshot(g, a, b, Math.min(1, t));
    this.applyState(newest);
    while (this.buf.length > 2 && this.buf[1].at < rt) this.buf.shift();
  }

  applyState(s) {
    const g = this.game, prev = g.state;
    g.state = s.state; g.timer = s.timer; g.clock = s.clock; g.half = s.half; g.score = s.score;
    SIDES.flip = s.half === 2 && this.swapHalves !== false ? -1 : 1;
    g.excite = s.excite; g.remoteProgress = s.progress; g.lastGoalDir = s.goalDir; g.replayReason = s.reason; g.kickTeam = s.kickTeam;
    g.rules.sp = s.sp;
    g.rules.so = s.so ? (g.rules.so || {}) : null;
    for (let i = 0; i < 2; i++) { const c = g.ctrls[i]; if (c) c.player = s.ctrl[i] >= 0 ? g.roster[s.ctrl[i]] : null; }
    if (prev !== s.state) g.onRemoteState?.(prev, s.state);
  }

  // Key presses (tackle, switch) are noticed every frame, but sent with the next packet; they are counted so that none is lost
  pollEdges() {
    const g = this.game, inp = g.input, k = SCHEMES.solo;
    if (g.modal || g.hold) { inp.consume(...k.swap); inp.consume(...k.tackle); return; }
    if (inp.consume(...k.swap)) this.swap++;
    if (inp.consume(...k.tackle)) this.tackle++;
  }

  sendInput() {
    const g = this.game, inp = g.input;
    const k = SCHEMES.solo, send = !g.modal && !g.hold && this.sampler;
    let mv = { dx: 0, dz: 0, l: 0 }, bits = 0;
    if (send) {
      mv = this.sampler.moveVector();
      const state = { sprint: inp.down(...k.sprint), shoot: inp.down(...k.shoot), curl: inp.down(...k.curl), pass: inp.down(...k.pass), up: inp.down(...k.up), down: inp.down(...k.down), left: inp.down(...k.left), right: inp.down(...k.right) };
      ACTIONS.forEach((a, i) => { if (state[a]) bits |= 1 << i; });
    }
    this.link.sendFast(new Float32Array([++this.seq, mv.dx, mv.dz, mv.l, bits, this.swap, this.tackle]));
  }

  dispose() {
    if (this.game.net === this) this.game.net = null;
    this.link.onmessage = this.link.onfast = this.link.onclose = () => {};
  }
}
