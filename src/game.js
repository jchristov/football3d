import * as THREE from 'three';
import { DIFFS, PITCH, GOAL, REACH, MATCH_TIME, BALL, SIDES, MATCH, TEAM_SIZES, setPitchForSize, clamp, angleDiff, attackDir, sc, sq } from './constants.js';
import { Ball } from './ball.js';
import { Player } from './player.js';
import { runAI, segDist } from './ai.js';
import { Controller, RemoteController, SCHEMES } from './controls.js';
import { Rules } from './rules.js';
import { Replay } from './replay.js';
import { styleOfTeam, TEAMS, pickKits, makeDiff, squad } from './teams.js';
import { Stats } from './stats.js';
import { Commentary } from './commentary.js';
import { Speech } from './speech.js';
import { settings, saveSettings, clampToughness } from './settings.js';
import { aptitude, tackleChance } from './skills.js';
import { STYLES } from './styles.js';
import { screenToGround, mouseActive } from './mouse.js';
import { computeRatings, manOfTheMatch } from './ratings.js';
import { Lineups } from './lineups.js';
import { homeSlots, gameStateShift } from './tactics.js';
import { snapshotOffside, isOffsidePosition, offsideLine, offsideSpot } from './offside.js';
import { BALL_FACES, RANDOM_FACE } from './ballskin.js';

const LOB_LIFT = 11.3;
const LOB_TIME = 0.9;

export const CAMERA_LABEL = { broadcast: 'Broadcast camera', follow: 'Following the selected player', ball: 'Following the ball', top: 'Bird\'s-eye view' };

export class Game {
  constructor({ scene, camera, world, env, hud, sfx, input }) {
    Object.assign(this, { scene, camera, world, env, hud, sfx, input });
    this.ball = new Ball();
    scene.add(this.ball.mesh);
    this.ball.onEvent = (type, v) => {
      if (type === 'kick') this.sfx.kick(Math.min(1, v / 28));
      else if (type === 'bounce' && v > 3) this.sfx.bounce(v);
      else if (type === 'post' || type === 'bar') { this.sfx.post(v, type === 'bar'); if (v > 6 && this.ball.lastToucher) this.comm.post(this.ball.lastToucher); }
      else if (type === 'wall' && v > 4) this.sfx.bounce(v);
    };

    // Players are created on demand and reused: a team of N plays with the first N of its pool
    this.pool = [[], []];
    this.teams = [[], []];
    this.all = [];
    this.roster = [];
    this.styles = [STYLES.balanced, STYLES.balanced]; // CPU play styles per team (see styles.js)
    this.events = []; // the match log: goals, cards, substitutions ... (shown in the events panel)
    this.eventsVersion = 0;
    this.setTeamSize(settings.teamSize || 5, { force: true });

    this.markers = [0xffd21e, 0x39e1ff].map((c) => this.makeMarker(c));
    // the pointer of the mouse on the pitch (see mouse.js): where the player runs to and aims at
    this.mouseGround = null; this.mouseOn = false; this.pointerRect = null;
    this.mouseMarker = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide }));
    this.mouseMarker.rotation.x = -Math.PI / 2; this.mouseMarker.position.y = 0.05; this.mouseMarker.renderOrder = 6; this.mouseMarker.visible = false;
    scene.add(this.mouseMarker);
    this.offsideLines = [0xffe36a, 0x7fe9ff].map((c) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 2), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.visible = false; m.scale.y = PITCH.hw; scene.add(m);
      return m;
    });

    this.lineups = new Lineups(this);
    this.tactics = this.lineups.tactics; // [team0, team1], shared with the AI
    this.stateShift = [0, 0];
    this.offsideOn = false;
    this.watch = null; // offside watch for the pass in the air
    this.stats = new Stats();
    this.speech = new Speech({ isMuted: () => this.sfx.muted });
    this.comm = new Commentary(this, hud);
    this.rules = new Rules(this);
    this.replay = new Replay(this);
    this.replay.configure(this.all.length);
    this.ctrls = [];
    this.cfg = null;
    this.mode = 'cpu';
    this.teamIdx = [0, 1];
    this.state = 'menu';
    this.prevState = 'menu';
    this.modal = false; // true while the settings panel is open
    this.half = 1; // 1 or 2; teams switch ends for the second half
    this.halfTimer = 0;
    this.lastGoalDir = 1;
    this.attract = true;
    this.autopilot = false;
    this.score = [0, 0];
    this.clock = MATCH_TIME;
    this.aiDiff = [makeDiff('normal', 3), makeDiff('normal', 3)];
    this.humanAssist = [0, 0];
    this.timer = 0;
    this.time = 0;
    this.excite = 0;
    this.deadT = 0;
    this.camMode = 0;
    this.camForward = { x: 0, z: -1 };
    this.camLook = new THREE.Vector3();
    this.camPos = new THREE.Vector3(0, 17, 27);
    this.lastBannerNum = -1;
    this.concedeTeam = 0;
    this.lastShot = null;
    this.bestGoal = null;
    this.onMatchEnd = () => {};
    this.setTeams(0, 1);
    this.startAttract();
  }

  makeMarker(color) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.75, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), new THREE.MeshBasicMaterial({ color }));
    arrow.rotation.x = Math.PI; arrow.position.y = 2.7;
    g.add(ring, arrow);
    g.visible = false;
    g.userData.arrow = arrow;
    this.scene.add(g);
    return g;
  }

  // ---------- setup ----------
  teamCode(t) { return TEAMS[this.teamIdx[t]].code; }
  teamName(t) { return TEAMS[this.teamIdx[t]].name; }

  // Re-read squads (after the squad editor changed a name or look) without resetting the match
  refreshSquads() {
    this.lineups.refreshRosters(this.teamIdx);
    for (let t = 0; t < 2; t++) this.lineups.applyIdentities(t);
  }

  // Change a team's tactics (formation / pressing) in the middle of a match
  setTactics(team, tactics) {
    this.lineups.setTactics(team, { ...this.tactics[team], ...tactics });
    this.lineups.applyFormation(team);
  }

  // Minute of play on a 90-minute scale, however long the match is
  matchMinute() {
    const len = this.cfg?.length || MATCH_TIME;
    return Math.max(1, Math.min(90, Math.ceil(((len - this.clock) / len) * 90)));
  }

  // Add a line to the match log (team -1 = neutral, e.g. half time)
  logEvent(type, team, data = {}) {
    if (this.attract) return;
    this.events.push({ type, team, minute: this.matchMinute(), half: this.half, ...data });
    this.eventsVersion++;
  }

  clearEvents() { this.events = []; this.eventsVersion++; }

  // An injury: the player limps on; the CPU replaces him at once, a human is told to (U)
  injure(p) {
    const team = p.team, L = this.lineups;
    L.injure(team, p.squadSlot);
    this.comm.injury(p);
    this.logEvent('injury', team, { name: p.name });
    this.sfx.groan?.();
    this.hud.toast(`🩹 INJURY · #${p.num} ${p.name}`, 2200);
    if (!this.aiControlled(team)) return;
    const bk = L.bestBenchIndex(team);
    if (bk >= 0 && L.canSub(team) && !p.isGK) this.substitute(team, p.index, bk);
  }

  // A red card: the player leaves the pitch for good and his team plays a man short
  sendOff(p) {
    const team = p.team, res = this.lineups.sendOff(team, p.index);
    if (res?.keeper) { this.comm.keeperOn(team, res.keeper); this.logEvent('keeper', team, { name: res.keeper.name }); }
    this.lineups.applyFormation(team);
    return res;
  }

  removePlayer(p) {
    p.dead = true;
    p.mesh.visible = false;
    p.stunT = 0;
    this.teams[p.team] = this.teams[p.team].filter((x) => x !== p);
    this.all = [...this.teams[0], ...this.teams[1]];
    if (this.ball.owner === p) this.ball.owner = null;
    for (const c of this.ctrls) if (c.player === p) { c.player = null; c.select(true); }
  }

  substitute(team, pitchIdx, benchK) {
    const r = this.lineups.substitute(team, pitchIdx, benchK);
    if (r) { this.comm.sub(team, r.out, r.in); this.sfx.whistle?.(); this.logEvent('sub', team, { inName: r.in.name, outName: r.out.name }); }
    return r;
  }

  get humanTeams() { return this.ctrls.map((c) => c.team); }

  // Changing the team size re-shapes the game: pitch and stadium, players, formations, bench and replay buffers.
  setTeamSize(size, { force = false } = {}) {
    size = TEAM_SIZES.includes(Number(size)) ? Number(size) : 5;
    const changed = force || size !== MATCH.size || !this.pool[0].length;
    setPitchForSize(size);
    for (let t = 0; t < 2; t++) {
      while (this.pool[t].length < size) {
        const p = new Player(t, { role: 'MID', lx: 0, lz: 0 }, this.pool[t].length);
        p.look = this.ball.pos;
        this.scene.add(p.mesh);
        this.pool[t].push(p);
      }
      this.teams[t] = this.pool[t].slice(0, size);
      this.pool[t].forEach((p, i) => { p.mesh.visible = i < size; p.index = i; p.isGK = i === 0; p.dead = false; p.yellows = 0; });
    }
    this.all = [...this.teams[0], ...this.teams[1]];
    this.roster = [...this.all]; // everybody who started the match, sent off or not (the replay buffers rely on a fixed list)
    if (!changed) return;
    if (this.lineups) this.lineups.size = size;
    this.world.rebuild?.();
    this.replay?.configure(this.all.length);
    for (const m of this.offsideLines || []) m.scale.y = PITCH.hw;
    this.env?.set?.(this.env.time, this.env.weather); // lights and the wet / snowy look belong to the new stadium
  }

  setTeams(a, b) {
    this.teamIdx = [a, b];
    const kits = pickKits(a, b);
    this.kits = kits;
    this.lineups.reset(this.teamIdx, MATCH.size);
    for (let t = 0; t < 2; t++) {
      this.teams[t].forEach((p, i) => p.setKit(p.isGK ? kits.gk[t] : kits.outfield[t]));
      this.lineups.applyFormation(t);
      this.lineups.applyIdentities(t);
    }
    this.kits = kits;
    this.applyNames();
  }

  applyNames() {
    const who = { '1p': ['YOU', 'CPU'], '2p': ['P1', 'P2'], cpu: ['', ''] }[this.mode] || ['', ''];
    this.hud.setTeams([this.teamCode(0), this.teamCode(1)], this.kits.outfield.map((k) => k.shirt), this.autopilot && this.mode === '1p' ? ['AUTO', 'CPU'] : who);
  }

  applyEnv(env) {
    if (env?.stadium) this.world.setLook?.(env.stadium); // the stadium has to exist before the lights and weather are set
    if (env) this.env.set(env.time, env.weather, env.windAngle);
    this.ball.roll = this.env.physics.roll;
    const W = this.env.physics || {};
    for (const p of this.all) { p.grip = W.grip; p.envDrain = W.drain || 1; }
    this.ball.windAcc = W.wind ? { x: Math.cos(this.env.windAngle || 0) * W.wind, z: Math.sin(this.env.windAngle || 0) * W.wind } : null;
  }

  startAttract(teams = [0, 1]) {
    this.net?.matchEnded?.();
    this.attract = true;
    this.ball.walls = settings.restarts === false;
    this.remote = null;
    this.lineups.unavailable = [new Set(), new Set()];
    this.cfg = null;
    this.mode = 'cpu';
    this.autopilot = false;
    this.ctrls = [];
    this.setTeamSize(settings.teamSize || 5);
    this.setTeams(...teams);
    this.lineups.initTactics(settings.tactics, [], this.teamIdx);
    this.styles = [0, 1].map((t) => styleOfTeam(this.teamIdx[t]));
    for (let t = 0; t < 2; t++) { this.lineups.autoAssign(t); this.lineups.applyFormation(t); this.lineups.applyIdentities(t); }
    this.offsideOn = false;
    this.watch = null;
    this.half = 1;
    SIDES.flip = 1;
    this.score = [0, 0];
    this.clock = MATCH_TIME;
    this.aiDiff = [makeDiff('normal', TEAMS[teams[0]].rating), makeDiff('normal', TEAMS[teams[1]].rating)];
    this.humanAssist = [0, 0];
    this.rules.reset();
    this.clearEvents();
    this.stats.reset();
    this.stats.enabled = false;
    this.comm.reset();
    this.hud.setAutopilot(false);
    this.hud.showReplay(false);
    this.hud.hideBanner();
    this.hud.hideCard();
    this.applyEnv();
    this.resetKickoff(0);
    this.state = 'playing';
  }

  // cfg: { mode: '1p'|'2p'|'cpu', teams: [a, b], diff, length, knockout, env, onEnd }
  startMatch(cfg) {
    if (!cfg.net) { this.net?.matchEnded?.(); this.remote = null; }
    this.attract = false;
    this.hold = false;
    this.ball.walls = settings.restarts === false;
    this.lineups.unavailable = [new Set(cfg.suspended || []), new Set()]; // banned players of the user's team (cup / league)
    this.lineups.form = [new Map(Object.entries(cfg.form || {}).map(([k, v]) => [Number(k), v])), new Map()]; // career: players in and out of form
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.autopilot = cfg.mode === 'cpu';
    this.setTeamSize(cfg.size || settings.teamSize || 5);
    this.setTeams(...cfg.teams);
    this.ctrls = [];
    if (cfg.mode === '1p') this.ctrls.push(new Controller(this, 0, 'solo'));
    this.remote = cfg.net?.role === 'guest' ? cfg.net : null; // an online guest only draws what the host reports
    if (cfg.mode === '2p' && cfg.net?.role === 'host') this.ctrls.push(new Controller(this, 0, 'solo'), new RemoteController(this, 1));
    else if (cfg.mode === '2p' && cfg.net) this.ctrls.push(new Controller(this, 0, 'net'), new Controller(this, 1, 'net')); // placeholders: the host decides who is controlled
    else if (cfg.mode === '2p') this.ctrls.push(new Controller(this, 0, 'p1'), new Controller(this, 1, 'p2'));
    this.lineups.initTactics(cfg.tactics || settings.tactics, this.ctrls.map((c) => c.team), this.teamIdx);
    this.styles = [0, 1].map((t) => (this.ctrls.some((c) => c.team === t) ? STYLES.balanced : styleOfTeam(this.teamIdx[t])));
    for (let t = 0; t < 2; t++) this.lineups.applyFormation(t);
    this.offsideOn = cfg.offside ?? settings.offside;
    this.watch = null;
    this.halftimeDone = false;
    this.half = 1;
    SIDES.flip = 1;
    const mateDiff = cfg.mode === '1p' || cfg.mode === '2p' ? 'normal' : cfg.diff;
    this.aiDiff = [makeDiff(mateDiff, TEAMS[cfg.teams[0]].rating), makeDiff(cfg.mode === '2p' ? 'normal' : cfg.diff, TEAMS[cfg.teams[1]].rating, cfg.mode === '1p' ? clampToughness(cfg.toughness ?? settings.cpuToughness) : 3)];
    this.humanAssist = [cfg.mode === '1p' ? (DIFFS[cfg.diff]?.assist || 0) : 0, 0]; // only in a 1-player match
    this.score = [0, 0];
    this.clock = cfg.length || MATCH_TIME;
    this.excite = 0;
    this.camMode = Math.max(0, this.camModes.indexOf(settings.camera)); // the camera chosen last time (C)
    this.world.confetti.update(10);
    this.rules.reset();
    this.clearEvents();
    this.ball.rollFace();
    if (settings.ball === RANDOM_FACE && this.ball.face) this.hud.toast(`🎲 Ball: ${BALL_FACES[this.ball.face].label}`, 2200);
    this.stats.reset();
    this.comm.reset();
    this.kickoffSaid = false;
    this.bestGoal = null;
    this.lastShot = null;
    for (const p of this.all) { p.energy = 1; p.stamina = 1; }
    this.lineups.reset(this.teamIdx, MATCH.size);
    for (let t = 0; t < 2; t++) { this.lineups.autoAssign(t); this.lineups.applyFormation(t); this.lineups.applyIdentities(t); }
    this.replay.clear();
    this.applyEnv(cfg.env);
    this.applyNames();
    this.hud.setAutopilot(false);
    this.hud.showReplay(false);
    this.hud.setControlsHelp(cfg.net ? '1p' : cfg.mode);
    const wx = this.env.weather;
    if (wx === 'mud') this.hud.toast('🟤 Muddy pitch: heavy going', 2600);
    else if (wx === 'wind') this.hud.toast(`💨 Windy: it pushes the ball from the ${['west', 'north-west', 'north', 'north-east', 'east', 'south-east', 'south', 'south-west'][((Math.round(((this.env.windAngle || 0) + Math.PI) / (Math.PI / 4)) % 8) + 8) % 8]}`, 2800);
    if (typeof document !== 'undefined') document.body.classList.toggle('two', cfg.mode === '2p');
    this.hud.hideCard();
    this.resetKickoff(0);
    for (const c of this.ctrls) c.select(true);
    this.hud.showMenu(false);
    this.hud.showEnd(false);
    this.hud.show(true);
  }

  isHuman(p) { return this.ctrls.some((c) => c.enabled && c.player === p); }
  ctrlOf(team) { return this.ctrls.find((c) => c.team === team && c.enabled) || null; }
  get cpuOnly() { return !this.ctrls.some((c) => c.enabled); }
  get shootoutLive() { return !!this.rules.so; }

  toggleAutopilot() {
    if (this.mode !== '1p' || this.state === 'ended' || this.rules.so) return;
    const c = this.ctrls[0];
    c.enabled = !c.enabled;
    if (!c.enabled) c.reset(); else c.select(true);
    this.autopilot = !c.enabled;
    this.applyNames();
    this.hud.setAutopilot(this.autopilot);
    this.input.keys.delete('Space');
  }

  resetKickoff(kickTeam) {
    this.ball.reset(0, 0);
    for (let t = 0; t < 2; t++) {
      const d = attackDir(t);
      const circle = sc(4.5) + 0.7; // the opponents of the team that kicks off stay outside the centre circle
      this.teams[t].forEach((p) => {
        let lx = p.home.lx, lz = p.home.lz;
        lx = Math.min(lx, t === kickTeam ? PITCH.hl - (p.role === 'FWD' ? 1 : 2.5) : PITCH.hl - circle);
        p.place(d * (lx - PITCH.hl), lz, d > 0 ? 0 : Math.PI);
        p.celebrate = false;
      });
    }
    for (const c of this.ctrls) c.reset();
    this.watch = null;
    if (!this.attract && this.cfg && this.clock < this.cfg.length * 0.7) this.cpuSubs(0.22);
    this.state = 'countdown';
    this.timer = this.attract ? 1.2 : 3.2;
    this.lastBannerNum = -1;
    this.kickTeam = kickTeam;
    this.excite = 0;
    this.deadT = 0;
  }

  // ---------- helpers ----------
  possessionTeam() {
    const o = this.ball.owner;
    if (!o) return -1;
    if (this.ball.held) return o.team;
    return Math.hypot(o.pos.x - this.ball.pos.x, o.pos.z - this.ball.pos.z) < 2.5 ? o.team : -1;
  }

  canKick(p) {
    const b = this.ball;
    if (b.held && b.held !== p) return false;
    if (p.stunT > 0 || p.lungeT > 0) return false;
    return b.held === p || (Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) < 1.9 && b.pos.y < 1.6);
  }

  // kind: 'shot' | 'pass' | 'other' (feeds the match statistics and commentary)
  doKick(p, angle, speed, lift, spin = 0, kind = 'other') {
    const sp = this.rules.sp;
    if (sp && sp.type === 'throw' && sp.kicker === p) { speed = Math.min(speed, 13); lift = Math.max(lift, 1.4); kind = 'pass'; } // a throw is a short, lofted pass
    if (kind === 'shot') speed *= aptitude(p, 'att'); // strikers hit it harder
    this.stats.touch(p, this.time);
    this.ball.kick(p, angle, speed, lift, spin);
    if (kind === 'pass') {
      this.stats.pass(p);
      this.watch = null;
      if (this.offsideOn && this.state === 'playing' && !this.rules.so) {
        const dir = attackDir(p.team);
        const set = snapshotOffside(p, this.teams[p.team], this.teams[1 - p.team], this.ball.pos.x, dir);
        if (set.size) this.watch = { team: p.team, from: p, set, t: this.time };
      }
    }
    else if (kind === 'shot') {
      const info = this.stats.shot(p, angle, speed, this.time);
      if (info && !this.rules.so) this.comm.shot(p, info);
      this.lastShot = { p, time: this.time, dist: Math.abs(attackDir(p.team) * PITCH.hl - p.pos.x), curl: Math.abs(spin) > 0.2, air: this.ball.pos.y > 0.6, header: false };
    }
    const dir = attackDir(p.team);
    if (speed > 17 && Math.cos(angle) * dir > 0.5 && (dir * PITCH.hl - p.pos.x) * dir < 16) this.sfx.ooh(0.35);
    p.kickCd = 0.35;
    p.kickAnim = 0.2;
    p.facing = angle;
  }

  passSpeed(dist) { return clamp(dist * 1.1 + 5, 8, 22); }

  passTo(p, target, quality = 1, lift = 0) {
    if (!this.canKick(p)) return false;
    const dist = Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
    const sp = this.passSpeed(dist);
    const lead = (dist / sp) * 0.7;
    const tx = target.pos.x + target.vel.x * lead, tz = target.pos.z + target.vel.z * lead;
    const sharp = clamp(quality * aptitude(p, 'mid'), 0, 1.1); // midfielders pass more accurately
    const angle = Math.atan2(tz - p.pos.z, tx - p.pos.x) + (Math.random() - 0.5) * 0.12 * (1 - sharp * 0.6);
    this.doKick(p, angle, sp, lift, 0, 'pass');
    return true;
  }

  // High cross timed to reach head height at the receiver
  lobTo(p, target) {
    if (!this.canKick(p)) return false;
    const dist = Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
    if (dist < 6) return this.passTo(p, target);
    const lead = LOB_TIME * 0.8;
    const tx = target.pos.x + target.vel.x * lead, tz = target.pos.z + target.vel.z * lead;
    const d2 = Math.hypot(tx - p.pos.x, tz - p.pos.z);
    this.doKick(p, Math.atan2(tz - p.pos.z, tx - p.pos.x) + (Math.random() - 0.5) * 0.06 / aptitude(p, 'mid'), clamp(d2 / LOB_TIME, 9, 26), LOB_LIFT, 0, 'pass');
    this.comm.cross(p);
    return true;
  }

  bestPass(p, mates, opp, d, wantAngle = null) {
    let best = null, bs = -Infinity;
    for (const t of mates) {
      if (t === p || t.isGK) continue;
      const dist = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
      const st = this.styles[p.team] || STYLES.balanced;
      if (dist < 4 || dist > 26 * Math.pow(PITCH.s, 0.75) * (st.distance > 1.5 ? 0.65 : 1)) continue; // long passes are possible on a bigger pitch
      if (this.offsideOn && wantAngle === null && isOffsidePosition(t, this.ball.pos.x, opp, d)) continue;
      const ang = Math.atan2(t.pos.z - p.pos.z, t.pos.x - p.pos.x);
      let score;
      if (wantAngle !== null) {
        const da = Math.abs(angleDiff(wantAngle, ang));
        if (da > 0.9) continue;
        score = 6 - da * 6 - dist * 0.1;
      } else {
        score = d * (t.pos.x - p.pos.x) * 0.6 * st.forward - dist * 0.15 * st.distance; // the play style shapes what a good pass is
      }
      let lane = 99, near = 99;
      for (const o of opp) {
        if (o.isGK) continue;
        lane = Math.min(lane, segDist(o.pos.x, o.pos.z, p.pos.x, p.pos.z, t.pos.x, t.pos.z));
        near = Math.min(near, Math.hypot(o.pos.x - t.pos.x, o.pos.z - t.pos.z));
      }
      if (lane < 1.4) continue;
      score += Math.min(lane, 6) * 0.8 - (near < 2.2 ? 3 : 0);
      if (score > bs) { bs = score; best = t; }
    }
    return bs > -2 ? best : null;
  }

  // Curler aimed at the post furthest from the keeper: launched wide, bends back in
  curlShot(p, speed, lift, targetZ = null) {
    const dir = attackDir(p.team), gx = dir * PITCH.hl;
    const gk = this.teams[1 - p.team][0];
    let tz = targetZ;
    if (tz === null) {
      const side = Math.abs(gk.pos.z) > 0.4 ? -Math.sign(gk.pos.z) : (p.pos.z > 0 ? -1 : 1);
      tz = side * (GOAL.hw - 0.7);
    }
    const D = Math.hypot(gx - p.pos.x, tz - p.pos.z);
    const phi = Math.atan2(tz - p.pos.z, gx - p.pos.x);
    const omega = clamp(0.5 + D * 0.012, 0.55, 0.8);
    const T = D / (speed * 0.85);
    let best = 1, bz = -1;
    for (const s of [1, -1]) {
      const zMid = p.pos.z + Math.sin(phi - s * omega * T / 2) * D / 2;
      if (Math.abs(zMid) > bz) { bz = Math.abs(zMid); best = s; }
    }
    this.doKick(p, phi - best * omega * T / 2, speed, lift, best * omega, 'shot');
    return true;
  }

  aiShoot(p, diff, d) {
    if (!this.canKick(p)) return;
    const gk = this.teams[1 - p.team][0];
    const tz = (gk.pos.z > 0 ? -1 : 1) * (2 + Math.random() * 0.9) + (Math.random() - 0.5) * diff.aim * 18;
    const gd = Math.hypot(d * PITCH.hl - p.pos.x, p.pos.z);
    if (gd > 9 && Math.random() < 0.28) { this.curlShot(p, 20 + Math.random() * 3, 5.5, clamp(tz, -GOAL.hw + 0.5, GOAL.hw - 0.5)); return; }
    const angle = Math.atan2(tz - p.pos.z, d * PITCH.hl - p.pos.x);
    this.doKick(p, angle, 19 + Math.random() * 7, 0.4 + Math.random() * 1.6, 0, 'shot');
  }

  clear(p, d) {
    if (!this.canKick(p)) return;
    const angle = Math.atan2(-Math.sign(p.pos.z || 1) * 10 - p.pos.z * 0.2, d * 14);
    this.doKick(p, angle, 21, 4);
  }

  keeperRelease(p, d) {
    const mates = this.teams[p.team], opp = this.teams[1 - p.team];
    const t = this.bestPass(p, mates, opp, d);
    if (t) {
      const dist = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
      const sp = this.passSpeed(dist);
      const angle = Math.atan2(t.pos.z - p.pos.z, t.pos.x - p.pos.x);
      this.doKick(p, angle, sp, 2.5);
    } else this.doKick(p, d > 0 ? 0.3 * (Math.random() - 0.5) : Math.PI, 17, 4);
    p.kickCd = 0.5;
  }

  onSave(p, speed = 0) {
    this.watch = null;
    this.stats.touch(p, this.time);
    if (this.rules.so) this.rules.so.saved = true;
    else { this.stats.saves[p.team]++; this.stats.recSave(p); this.comm.save(p, speed > 12); }
    if (!this.cpuOnly || p.team === 0) this.excite = Math.max(this.excite, 0.15);
  }

  // ---------- human actions ----------
  humanShoot(p, charge, curl = false) {
    if (!this.canKick(p)) return;
    const b = this.ball;
    const dir = attackDir(p.team), gx = dir * PITCH.hl;
    const inRange = Math.abs(gx - p.pos.x) < sq(26);
    const air = b.pos.y > 0.45 && !b.held;
    let speed = 11 + 17 * charge, lift = 0.6 + 5 * charge * charge;
    if (air) { speed = speed * 1.05 + Math.min(b.speed * 0.35, 5); lift = 0.4 + 2 * charge * charge; }
    if (curl && inRange && charge > 0.3) {
      this.hud.toast('CURLER!');
      this.comm.curler(p);
      this.curlShot(p, Math.max(speed, 17), 5.5);
      return;
    }
    let angle = p.facing;
    const toGoal = Math.atan2(-p.pos.z * 0.4, gx - p.pos.x);
    const dg = angleDiff(angle, toGoal);
    if (Math.abs(dg) < 0.55 && inRange) angle += dg * 0.6;
    if (air && speed > 20) { this.hud.toast('VOLLEY!'); this.comm.volley(p); }
    this.doKick(p, angle, speed, lift, 0, 'shot');
  }

  humanPass(p, want, lob) {
    if (!this.canKick(p)) return;
    const dir = attackDir(p.team);
    const dirAngle = want ?? p.facing;
    const t = this.bestPass(p, this.teams[p.team], this.teams[1 - p.team], dir, want);
    if (lob) {
      if (t) this.lobTo(p, t);
      else this.doKick(p, dirAngle, 16, LOB_LIFT, 0, 'pass');
    } else if (t) this.passTo(p, t, 1);
    else this.doKick(p, dirAngle, 12, 0, 0, 'pass');
  }

  // Called whenever a player touches the ball in open play
  checkOffside(p) {
    const w = this.watch;
    if (!w) return;
    if (p.team !== w.team) { this.watch = null; return; }
    if (p !== w.from && w.set.has(p)) { this.watch = null; this.rules.offside(p); }
  }

  // ---------- simulation ----------
  header(p) {
    const b = this.ball, ctrl = this.ctrls.find((c) => c.enabled && c.player === p);
    const dir = attackDir(p.team), gx = dir * PITCH.hl;
    const gd = Math.hypot(gx - p.pos.x, p.pos.z);
    p.headCd = 0.7; p.jumpT = 0.5;
    this.stats.headers[p.team]++;
    this.stats.recHeader(p);
    this.stats.touch(p, this.time);
    this.checkOffside(p);
    if (this.state !== 'playing') return;
    let angle, speed, lift, atGoal = false;
    if (ctrl) {
      const mv = ctrl.moveVector();
      const power = this.input.down(...ctrl.keys.shoot);
      if (power && gd < 24) {
        angle = Math.atan2(-p.pos.z * 0.35, gx - p.pos.x);
        speed = (12 + 9 * Math.max(0.5, p.charge)) * aptitude(p, 'att');
        lift = 0.1;
        this.hud.toast('HEADER!');
        atGoal = true;
      } else {
        angle = mv.l > 0 ? Math.atan2(mv.dz, mv.dx) : p.facing;
        speed = clamp(b.speed * 0.5 + 5, 6, 13) * aptitude(p, 'def');
        lift = 2.2;
      }
      p.charge = 0;
    } else {
      const gk = this.teams[1 - p.team][0];
      const mates = this.teams[p.team], opp = this.teams[1 - p.team];
      if (gd < 18 && Math.random() < 0.75) {
        const tz = (gk.pos.z > 0 ? -1 : 1) * (1.8 + Math.random() * 1.2);
        angle = Math.atan2(tz - p.pos.z, gx - p.pos.x);
        speed = (14 + Math.random() * 5) * aptitude(p, 'att'); lift = 0.2;
        atGoal = true;
      } else {
        const t = this.bestPass(p, mates, opp, dir);
        if (t) { angle = Math.atan2(t.pos.z - p.pos.z, t.pos.x - p.pos.x); speed = this.passSpeed(Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z)); lift = 1.5; }
        else { angle = (dir > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.8; speed = 14; lift = 3; }
      }
    }
    b.kick(p, angle, speed, lift);
    p.facing = angle;
    b.owner = p;
    if (atGoal) {
      const info = this.stats.shot(p, angle, speed, this.time);
      if (info && !this.rules.so) this.comm.shot(p, info);
      this.lastShot = { p, time: this.time, dist: gd, curl: false, air: true, header: true };
    }
    this.comm.header(p, atGoal);
  }

  contacts() {
    const b = this.ball;
    const cands = [];
    for (const p of this.all) {
      if (p.lungeT > 0) {
        for (const o of this.all) {
          if (o.team === p.team || o.isGK || o.stunT > 0) continue;
          if (Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) > 1.25) continue;
          if (this.rules.judgeTackle(p, o)) return;
          if (b.owner === o && Math.random() > tackleChance(p, o)) { p.lungeT = 0; continue; } // the carrier rides the tackle
          if (b.owner === o) {
            o.stunT = 0.8;
            b.vel.set(Math.cos(p.lungeAngle) * 7, 0.5, Math.sin(p.lungeAngle) * 7);
            b.spin = 0;
            b.owner = p; b.lastToucher = p;
            this.stats.tackles[p.team]++;
            this.stats.recTackle(p);
            this.rules.maybeInjure(o, 0.015);
            this.stats.touch(p, this.time);
            this.comm.tackle(p);
            const c = this.ctrls.find((k) => k.player === o);
            if (c) o.charge = 0;
          }
        }
      }
      if (p.isGK || b.held) continue;

      if (b.pos.y > 1.15 && b.pos.y < 2.7 && p.headCd <= 0 && p.kickCd <= 0 && p.stunT <= 0 && p.lungeT <= 0
        && Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) < 1.15) {
        this.header(p);
        continue;
      }

      const assist = 1 + (this.humanAssist[p.team] || 0); // beginner levels: the ball sticks to the feet of the human team
      const reach = (p.lungeT > 0 ? 1.5 : REACH) * (0.7 + BALL.r) * assist; // a smaller ball is a little harder to control
      const d = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
      if (d > reach || b.pos.y > 1.3 || p.kickCd > 0 || p.stunT > 0 || p.touchCd > 0) continue;
      const o = b.owner;
      if (o && o !== p && o.team !== p.team && p.lungeT <= 0 && o.stunT <= 0 && !b.held) {
        if (!this.winBallFrom(p, o, d)) continue;
      }
      cands.push({ p, d: d - (this.facingBall(p) ? 0.15 : 0) - (b.owner === p ? 0.3 : 0) });
    }
    if (!cands.length) return;
    cands.sort((x, y) => x.d - y.d);
    this.takeBall(cands[0].p);
  }

  facingBall(p) {
    const b = this.ball, dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z, l = Math.hypot(dx, dz) || 1;
    return (Math.cos(p.facing) * dx + Math.sin(p.facing) * dz) / l > 0.3;
  }

  // A defender who is standing at the ball carrier has to win a small duel: a carrier who shields the ball with the body
  // is hard to rob, one who runs straight into the defender or turns his back on the ball is easy prey.
  winBallFrom(p, o, d) {
    const b = this.ball;
    const cx = b.pos.x - o.pos.x, cz = b.pos.z - o.pos.z, cl = Math.hypot(cx, cz) || 1;
    const px = p.pos.x - o.pos.x, pz = p.pos.z - o.pos.z, pl = Math.hypot(px, pz) || 1;
    const open = (cx * px + cz * pz) / (cl * pl); // 1: the defender is on the side of the ball, -1: the body is between
    let chance = 0.3 * tackleChance(p, o) * (open > 0.2 ? 1.3 : open < -0.2 ? 0.25 : 0.6);
    if (d > 0.9) chance *= 0.5;
    if (o.speed > 5.5 && open < 0.5) chance *= 0.6; // a sprinter pushes the ball past the challenger
    const human = this.ctrls.some((k) => k.enabled && k.player === p);
    if (!human) chance *= Math.max(0.3, (this.aiDiff[p.team]?.tackle ?? 0.45) / 0.45);
    chance /= 1 + (this.humanAssist[o.team] || 0) * 2;
    p.touchCd = 0.35; // one attempt at a time, whatever the outcome
    if (Math.random() < chance) {
      this.rules.maybeInjure?.(o, 0.004);
      return true;
    }
    return false;
  }

  takeBall(p) {
    const b = this.ball, mine = b.owner === p;
    p.touchCd = mine ? 0.09 : 0.2; // the carrier keeps nudging the ball, so it stays at his feet
    b.owner = p; b.lastToucher = p;
    b.spin = 0;
    this.stats.touch(p, this.time);
    this.checkOffside(p);
    if (this.state !== 'playing') return;
    if (p.lungeT > 0) {
      b.vel.set(Math.cos(p.lungeAngle) * 9, 0, Math.sin(p.lungeAngle) * 9);
      return;
    }
    const sp = p.speed;
    if (sp < 0.8) { b.vel.x *= 0.5; b.vel.z *= 0.5; }
    else {
      const push = mine ? 1.3 + 0.2 * sp : 1.8 + 0.2 * sp; // a controlled dribble pushes the ball less far ahead
      b.vel.x = p.vel.x + Math.cos(p.facing) * push;
      b.vel.z = p.vel.z + Math.sin(p.facing) * push;
    }
    b.vel.y *= 0.3;
  }

  separate() {
    const a = this.all;
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
      const p = a[i], q = a[j];
      const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.8 && d > 1e-4) {
        const ob = this.ball.owner, dp = (0.8 - d), nx = dx / d, nz = dz / d;
        // the ball carrier shoulders his opponent away instead of being pushed off the ball
        const wp = ob === p && q.team !== p.team ? 0.3 : ob === q && q.team !== p.team ? 0.7 : 0.5;
        p.pos.x -= nx * dp * wp; p.pos.z -= nz * dp * wp;
        q.pos.x += nx * dp * (1 - wp); q.pos.z += nz * dp * (1 - wp);
      }
    }
  }

  simulate(dt) {
    const b = this.ball;
    for (const p of this.all) p.tick(dt);
    const so = this.rules.so;
    if (!so) for (const c of this.ctrls) { if (c.enabled) c.select(); c.update(dt); }
    runAI(this, dt);
    for (const c of this.ctrls) {
      const h = c.player;
      if (c.enabled && h && h.speed < 0.8 && h.lungeT <= 0) h.faceToward(b.pos.x, b.pos.z, dt);
    }
    if (!so && !this.attract) { this.stats.tick(this.possessionTeam(), dt); this.stats.tickPlayers(this.all, dt); }
    this.separate();
    this.contacts();
    if (b.owner && !b.held && Math.hypot(b.owner.pos.x - b.pos.x, b.owner.pos.z - b.pos.z) > 3.5) b.owner = null;
    b.step(dt);

    // A ball lying dead for too long gets "dropped" back towards the centre
    if (b.speed < 0.3 && !b.held && b.pos.y < 0.5 && !so) this.deadT += dt; else this.deadT = 0;
    if (this.deadT > 2.5) {
      this.deadT = 0;
      const l = Math.hypot(b.pos.x, b.pos.z) || 1;
      b.vel.set((-b.pos.x / l) * 5 + (Math.random() - 0.5) * 3, 0, (-b.pos.z / l) * 5 + (Math.random() - 0.5) * 3);
      b.owner = null;
    }

    if (b.netSide !== 0 && Math.abs(b.pos.x) > PITCH.hl + 0.3 && b.pos.y < GOAL.h) {
      this.onGoal(attackDir(0) === (b.netSide > 0 ? 1 : -1) ? 0 : 1);
    }
    if (!b.walls && this.state === 'playing') this.rules.checkOut();
  }

  onGoal(team) {
    if (this.rules.so) { this.rules.shootoutResult(true, 'GOAL!'); return; }
    this.watch = null;
    this.score[team]++;
    const scorer0 = this.ball.lastToucher;
    if (!this.attract) {
      const len = this.cfg?.length || MATCH_TIME;
      const own = !!scorer0 && scorer0.team !== team;
      const ls = this.lastShot && this.lastShot.p === scorer0 && this.time - this.lastShot.time < 5 ? this.lastShot : null;
      const minute = Math.max(1, Math.ceil(((len - this.clock) / len) * 90));
      const diff = this.score[team] - this.score[1 - team];
      const rating = own ? -99 : (ls ? Math.min(ls.dist, 28) * 0.45 + (ls.curl ? 7 : 0) + (ls.air && !ls.header ? 6 : 0) + (ls.header ? 4 : 0) : 2)
        + (diff === 0 ? 3 : diff === 1 ? 1.5 : 0) + (minute >= 80 ? 2 : 0) + (this.rules.sp?.type === 'penalty' ? -6 : 0);
      this.stats.goals.push({ team, name: scorer0 ? scorer0.name : '', num: scorer0 ? scorer0.num : 0, own, minute, rating, curl: !!ls?.curl, header: !!ls?.header, volley: !!ls && ls.air && !ls.header, dist: ls ? Math.round(ls.dist) : 0, dir: attackDir(team), half: this.half, clip: null });
      this.stats.recGoal(scorer0, own, this.time);
      this.logEvent('goal', team, { name: scorer0 ? scorer0.name : '', own, minute });
      this.comm.goal(team, scorer0, !!scorer0 && scorer0.team !== team, this.score);
    }
    this.concedeTeam = 1 - team;
    this.lastGoalTeam = team;
    this.goalAt = this.replay.now;
    this.state = 'goal';
    this.timer = 2.6;
    this.excite = 1;
    this.teams[team].forEach((p) => (p.celebrate = true));
    this.sfx.cheer();
    this.sfx.whistle();
    this.lastGoalDir = attackDir(team);
    this.world.confetti.burst(this.lastGoalDir * (PITCH.hl - 2), 0);
    const scorer = this.ball.lastToucher;
    this.hud.setBanner('GOAL!', scorer && scorer.team === team ? `${scorer.name} · ${this.teamName(team)}` : `${this.teamName(team)} — own goal`, 2400);
  }

  // ---------- match flow ----------
  timeUp() {
    this.sfx.finalWhistle();
    if (this.cfg && this.cfg.knockout && this.score[0] === this.score[1]) {
      this.rules.startShootout();
      this.hud.setBanner('FULL TIME', 'Level — penalties!', 1800);
    } else this.finishMatch(null, null);
  }

  finishMatch(pensWinner, pens) {
    this.state = 'ended';
    if (pensWinner !== null) this.sfx.whistle(true);
    const [a, b] = this.score;
    const winner = pensWinner !== null ? pensWinner : a > b ? 0 : a < b ? 1 : null;
    let msg;
    if (winner === null) msg = "It's a draw.";
    else if (this.mode === '1p') msg = winner === 0 ? 'You win! 🏆' : 'The CPU wins this one.';
    else if (this.mode === '2p') msg = `Player ${winner + 1} wins! 🏆`;
    else msg = `${this.teamName(winner)} win.`;
    if (pens) msg += ` (${pens[0]}-${pens[1]} on penalties)`;
    const ratings = this.attract ? [] : computeRatings(this.stats, [a, b], this.cfg?.length || MATCH_TIME);
    this.ratings = ratings;
    this.motm = manOfTheMatch(ratings, [a, b]);
    const result = { score: [a, b], pens, winner, mode: this.mode, teams: this.teamIdx, message: msg, discipline: this.lineups.disciplineReport(0), ratings, motm: this.motm };
    this.result = result;
    this.rules.so = null;
    this.rules.freezeOutfield = false;
    this.hud.setPens(null);
    this.hud.setEnd(this.score, msg);
    this.hud.renderStats('endStats', this);
    this.hud.renderRatings?.(this);
    this.hud.renderAnalysis?.(this);
    this.hud.renderScorers(this);
    this.hud.setBestGoal(this.pickBestGoal());
    this.comm.fullTime(msg);
    this.logEvent('ft', -1, { score: [...this.score] });
    this.hud.hideBanner();
    this.hud.showEnd(true);
    for (const c of this.ctrls) c.reset();
    this.cfg?.onEnd?.(result);
  }

  // ---------- tactics, half time, substitutions ----------
  aiControlled(team) { return !this.ctrls.some((c) => c.team === team && c.enabled); }

  // Teams push up when trailing and drop deeper when leading, more so late in the match
  updateGameState() {
    if (this.attract || !this.cfg) { this.stateShift[0] = this.stateShift[1] = 0; return; }
    const frac = Math.max(0, Math.min(1, this.clock / this.cfg.length));
    for (let t = 0; t < 2; t++) {
      const target = gameStateShift(this.score[t] - this.score[1 - t], frac);
      this.stateShift[t] += (target - this.stateShift[t]) * 0.02;
    }
  }

  // The CPU's own substitutions; humans decide for themselves
  cpuSubs(threshold) {
    for (let t = 0; t < 2; t++) {
      if (!this.aiControlled(t)) continue;
      const swap = this.cpuSwap(t, threshold);
      if (swap) this.substitute(t, swap[0], swap[1]);
    }
  }

  cpuSwap(team, threshold) {
    const L = this.lineups;
    if (!L.canSub(team)) return null;
    let worst = -1, we = 2;
    for (const p of this.teams[team]) if (!p.isGK && p.energy < we && p.stunT <= 0) { we = p.energy; worst = p.index; }
    let bk = -1, be = -1;
    L.bench[team].forEach((slot, k) => { const e = L.energy[team].get(slot) ?? 1; if (e > be) { be = e; bk = k; } });
    return worst >= 0 && bk >= 0 && be - we >= threshold ? [worst, bk] : null;
  }

  // True when the first half has run out (checked at every restart so a goal at the end of the half cannot skip the break)
  dueHalftime() { return !this.attract && !!this.cfg && !this.halftimeDone && this.clock <= this.cfg.length / 2; }

  startHalftime() {
    this.halftimeDone = true;
    this.watch = null;
    this.prevState = 'playing';
    this.state = 'halftime';
    this.sfx.finalWhistle();
    this.cpuSubs(0.1);
    this.hud.setBanner('HALF TIME', `${this.score[0]} - ${this.score[1]}`, 0);
    this.comm.halftime(this.score);
    this.logEvent('ht', -1, { score: [...this.score] });
    this.halfTimer = this.mode === 'cpu' ? 5 : 0; // a watched CPU match carries on by itself
    if (this.mode !== 'cpu') this.onHalftime();
  }

  // The second half: teams switch ends, the other team kicks off, everybody has caught their breath a little
  endHalftime() {
    if (this.state !== 'halftime') return;
    this.hud.hideBanner();
    this.half = 2;
    SIDES.flip = -1;
    this.halfTimer = 0;
    for (const p of this.all) p.energy = Math.min(1, p.energy + 0.25);
    this.comm.secondHalf();
    this.hud.toast('↔ Teams switch ends', 2600);
    this.resetKickoff(1);
  }

  onHalftime() {} // replaced by the UI

  updateOffsideLines() {
    this.offsideLines.forEach((m, t) => {
      const show = this.offsideOn && !this.attract && this.state === 'playing' && !this.rules.so && this.ctrls.some((c) => c.team === t && c.enabled);
      m.visible = show;
      if (!show) return;
      const dir = attackDir(t);
      m.position.x = offsideLine(this.teams[1 - t], dir) * dir;
    });
  }

  togglePause() {
    if (this.attract || this.remote) return;
    if (this.state === 'paused') { this.state = this.prevState; this.hud.showPause(false); }
    else if (['playing', 'countdown', 'goal', 'foul', 'setpiece', 'sopause'].includes(this.state)) {
      this.prevState = this.state; this.state = 'paused'; this.speech.stop(); this.hud.renderStats('pauseStats', this); this.hud.showPause(true);
    }
  }

  startReplay(from, to, reason, speed) {
    if (!this.replay.play(from, to, speed)) return false;
    if (reason === 'goal') {
      const rec = this.stats.goals[this.stats.goals.length - 1];
      if (rec && !rec.clip && !rec.own) rec.clip = this.replay.extract();
    }
    this.replayReason = reason;
    this.replayReturn = this.state;
    this.state = 'replay';
    this.hud.hideBanner();
    this.beginClipIfRequested();
    if (reason === 'goal') this.comm.replay();
    this.hud.showReplay(true);
    return true;
  }

  // Goal with the best "wow" rating that still has a recorded clip
  pickBestGoal() {
    const goals = this.stats.goals.filter((x) => x.clip && !x.own);
    this.bestGoal = goals.length ? goals.reduce((a, b) => (b.rating > a.rating ? b : a)) : null;
    return this.bestGoal;
  }

  playBest() {
    const bg = this.bestGoal;
    if (this.state !== 'ended' || !bg || !bg.clip) return false;
    this.replayReason = 'best';
    this.replayReturn = 'ended';
    this.lastGoalTeam = bg.team;
    this.lastGoalDir = bg.dir ?? 1;
    this.state = 'replay';
    this.replay.playClip(bg.clip, 0.6);
    this.beginClipIfRequested();
    this.hud.showEnd(false);
    this.hud.showReplay(true, `🎬 GOAL OF THE MATCH · ${bg.name} ${bg.minute}'`);
    return true;
  }

  // "Save as video": the next replay (or the one that is playing) is recorded and downloaded when it ends
  beginClipIfRequested() {
    if (!this.recordNext) return;
    this.recordNext = false;
    this.clipping = !!this.recorder?.start();
    this.hud.toast(this.clipping ? '⏺ Recording the replay…' : 'Video recording is not supported in this browser', 1800);
  }

  // Record the replay that is playing from its start (online guests: the rest of it)
  recordCurrentReplay() {
    if (this.state !== 'replay' || this.clipping || !this.recorder) return false;
    if (!this.remote) this.replay.t = this.replay.from;
    this.recordNext = true;
    this.beginClipIfRequested();
    return this.clipping;
  }

  endClip() {
    if (!this.clipping) return;
    this.clipping = false;
    this.recorder?.finish(this.replayReason === 'best' || this.replayReason === 'goal' ? 'goal' : 'replay').then((n) => { if (n) this.hud.toast(`💾 Saved ${n}`, 3500); });
  }

  endReplay() {
    this.endClip();
    this.replay.stop();
    this.hud.showReplay(false);
    if (this.replayReason === 'best') { this.state = 'ended'; this.hud.showEnd(true); return; }
    if (this.replayReason === 'goal') {
      if (this.clock <= 0 && !this.attract) this.timeUp();
      else if (this.dueHalftime()) this.startHalftime();
      else this.resetKickoff(this.concedeTeam);
    } else this.state = this.replayReturn;
  }

  handleKeys() {
    const inp = this.input;
    if (this.modal) { inp.pressed.clear(); return; } // a full-screen panel (settings...) owns the keyboard
    if (inp.consume('KeyM')) { this.sfx.toggleMute(); if (typeof document !== 'undefined') document.getElementById('muteBtn')?.blur(); }
    if (inp.consume('KeyT')) this.toggleAutopilot();
    if (inp.consume('KeyN')) this.comm.toggle();
    if (inp.consume('KeyC')) this.nextCamera();
    if (inp.consume('KeyP', 'Escape')) {
      if (this.state === 'replay') this.endReplay(); else this.togglePause();
    }
    if (this.state === 'replay' && inp.consume('Space', 'Enter')) this.endReplay();
    if (inp.consume('KeyV') && this.state === 'playing' && !this.rules.so && !this.attract) {
      this.startReplay(this.replay.now - 8, this.replay.now, 'manual', 0.8);
    }
  }

  // A finger on the screen at (clientX, clientY): the player of the human team that is closest to it in the picture (within
  // a fingertip) becomes the controlled one. Returns whether a player was hit.
  selectByTouch(clientX, clientY) {
    if (this.remote || this.attract || this.modal || this.state !== 'playing' || this.rules.so) return false;
    const c = this.ctrls.find((k) => k.enabled && k.keys === SCHEMES.solo);
    const r = this.pointerRect?.();
    if (!c || !r || !r.width || !r.height) return false;
    this.camera.updateMatrixWorld();
    const reach = clamp(r.height * 0.13, 38, 72); // px
    const v = new THREE.Vector3();
    let best = null, bd = reach;
    for (const p of this.teams[c.team]) {
      if (p.isGK || p.dead) continue;
      v.set(p.pos.x, 0.9, p.pos.z).project(this.camera);
      if (v.z > 1) continue;
      const d = Math.hypot(r.left + (v.x * 0.5 + 0.5) * r.width - clientX, r.top + (0.5 - v.y * 0.5) * r.height - clientY);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return false;
    if (c.pick(best) && typeof navigator !== 'undefined') navigator.vibrate?.(10);
    return true;
  }

  // C: broadcast -> follow the selected player -> follow the ball -> bird's eye
  nextCamera() {
    this.camMode = (this.camMode + 1) % this.camModes.length;
    settings.camera = this.camModes[this.camMode];
    saveSettings();
    this.hud.toast?.(`🎥 ${CAMERA_LABEL[settings.camera]}`, 1100);
  }

  get camModes() { return this.mode === '2p' ? ['broadcast', 'ball', 'top'] : ['broadcast', 'follow', 'ball', 'top']; }

  update(dtRaw) {
    const dt = Math.min(dtRaw, 0.05);
    if (this.remote) { this.updateRemote(dt); return; }
    this.time += dt;
    this.input.poll?.();
    this.handleKeys();
    this.updateMouse();
    this.net?.preUpdate?.(dt);

    switch (this.state) {
      case 'countdown': {
        if (!this.hold) this.timer -= dt; // the team sheets keep the kick-off waiting
        for (const p of this.all) { p.tick(dt); p.move(0, 0, false, dt); p.faceToward(0, 0, dt); }
        if (!this.attract) {
          const n = Math.ceil(this.timer - 0.2);
          if (n !== this.lastBannerNum) {
            this.lastBannerNum = n;
            const sub = this.mode === '1p' ? (this.kickTeam === 0 ? 'Your kick-off' : 'CPU kick-off') : `${this.teamCode(this.kickTeam)} kick-off`;
            if (n > 0) this.hud.setBanner(String(n), sub); else this.hud.hideBanner();
          }
        }
        if (this.timer <= 0) {
          this.state = 'playing'; this.sfx.whistle(); this.hud.hideBanner();
          if (!this.kickoffSaid && !this.attract) { this.kickoffSaid = true; this.comm.kickoff(); }
        }
        this.ball.step(dt);
        break;
      }
      case 'playing':
        this.simulate(dt);
        if (!this.attract) this.comm.tick(this.clock, this.cfg?.length || MATCH_TIME);
        if (this.state === 'playing' && this.rules.so) this.rules.liveUpdate(dt);
        if (this.state === 'playing' && !this.attract && !this.rules.so) {
          this.clock -= dt;
          if (this.clock <= 0) { this.clock = 0; this.timeUp(); }
          else if (!this.halftimeDone && this.cfg && this.clock <= this.cfg.length / 2) this.startHalftime();
        }
        if (this.watch && this.time - this.watch.t > 4.5) this.watch = null;
        break;
      case 'goal':
        for (const p of this.all) { p.tick(dt); p.move(0, 0, false, dt); }
        this.contacts();
        this.ball.step(dt);
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.attract) this.resetKickoff(this.concedeTeam);
          else if (!this.startReplay(this.goalAt - 5.5, this.goalAt + 1.4, 'goal', 0.65)) {
            if (this.clock <= 0) this.timeUp(); else if (this.dueHalftime()) this.startHalftime(); else this.resetKickoff(this.concedeTeam);
          }
        }
        break;
      case 'foul': this.rules.updateFoul(dt); break;
      case 'setpiece': this.rules.updateSetPiece(dt); break;
      case 'sopause': this.rules.updatePause(dt); break;
      case 'halftime':
        for (const p of this.all) { p.tick(dt); p.move(0, 0, false, dt); }
        this.ball.step(dt);
        if (this.halfTimer > 0 && (this.halfTimer -= dt) <= 0) this.endHalftime();
        break;
      case 'replay':
        if (!this.replay.step(dt)) this.endReplay();
        break;
      case 'ended':
        for (const p of this.all) { p.tick(dt); p.move(0, 0, false, dt); }
        this.ball.step(dt);
        break;
      case 'paused':
        break;
    }

    this.comm.update();
    if (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'replay') for (const p of this.all) p.rest(dt);
    if (!this.attract) this.lineups.tickBench(dt);
    this.updateGameState();
    this.updateOffsideLines();
    this.excite = Math.max(0, this.excite - dt * (this.state === 'goal' ? 0.12 : 0.4));
    this.updateCamera(dt);
    this.env.update(dt, this.camera);

    if (this.state !== 'paused' && this.state !== 'replay') {
      for (const p of this.all) { p.holding = this.ball.held === p; p.syncMesh(dt, this.time); }
      this.ball.attach();
      this.replay.record(dt);
    }
    if (this.state !== 'paused') {
      this.world.crowd.update(this.time, this.excite);
      this.world.confetti.update(dt);
    }
    this.updateMarkers();
    this.updateAudio();
    this.hud.update(this, dt);
    this.net?.postUpdate?.(dt);
    this.input.endFrame();
  }

  // An online guest: no simulation, just its own camera, HUD and keys. The host's snapshots drive everything else.
  updateRemote(dt) {
    this.time += dt;
    this.input.poll?.();
    const inp = this.input;
    if (!this.modal) {
      if (inp.consume('KeyM')) { this.sfx.toggleMute(); if (typeof document !== 'undefined') document.getElementById('muteBtn')?.blur(); }
      if (inp.consume('KeyN')) this.comm.toggle();
      if (inp.consume('KeyC')) this.nextCamera();
      if (inp.consume('KeyP', 'Escape', 'KeyV', 'KeyT')) this.hud.toast('Only the host can do that', 1200);
    } else inp.pressed.clear();
    this.updateMouse();
    this.net?.tick?.(dt);
    if (this.clipping && this.state !== 'replay') this.endClip();
    this.updateCamera(dt);
    this.env.update(dt, this.camera);
    this.world.crowd.update(this.time, this.excite);
    this.world.confetti.update(dt);
    this.updateMarkers();
    this.updateAudio();
    this.hud.update(this, dt);
    inp.endFrame();
  }

  // The pointer of the mouse as a point on the pitch (null when it is not steering)
  updateMouse() {
    const m = this.input.mouse;
    this.mouseOn = mouseActive(m) && !this.modal && this.ctrls.some((c) => c.enabled && c.keys === SCHEMES.solo);
    this.mouseGround = null;
    if (!this.mouseOn || !this.pointerRect) return;
    const r = this.pointerRect();
    if (!r.width || !r.height) return;
    this.mouseGround = screenToGround(this.camera, ((m.x - r.left) / r.width) * 2 - 1, -(((m.y - r.top) / r.height) * 2 - 1));
  }

  updateMarkers() {
    const live = !['ended', 'replay'].includes(this.state);
    this.mouseMarker.visible = !!this.mouseGround && live && this.state !== 'paused';
    if (this.mouseMarker.visible) { this.mouseMarker.position.set(this.mouseGround.x, 0.05, this.mouseGround.z); this.mouseMarker.scale.setScalar(1 + Math.sin(this.time * 6) * 0.08); }
    this.markers.forEach((m, i) => {
      const c = this.ctrls[i], p = c && c.enabled ? c.player : null;
      m.visible = !!p && live;
      if (p) {
        m.position.set(p.pos.x, 0, p.pos.z);
        m.userData.arrow.position.y = 2.7 + Math.sin(this.time * 5) * 0.12;
      }
    });
  }

  updateAudio() {
    const b = this.ball.pos;
    const nearGoal = Math.max(0, 1 - (PITCH.hl - Math.abs(b.x)) / 12);
    this.sfx.setCrowd(Math.max(this.excite, nearGoal * 0.35));
  }

  updateCamera(dt) {
    const cam = this.camera, b = this.ball.pos;
    const modes = this.camModes;
    const mode = modes[this.camMode % modes.length];
    const aspect = cam.aspect || 1.6;
    const zoom = aspect < 1.5 ? 1 + (1.5 - aspect) * 0.6 : 1;
    const cs = Math.pow(PITCH.s, 0.95); // the camera pulls back on a bigger pitch
    let pos, look, fwd = { x: 0, z: -1 }, k = 1 - Math.exp(-4 * dt);
    cam.up.set(0, 1, 0);
    const sp = this.rules.sp;

    if (this.state === 'replay') {
      const bp = this.ball.mesh.position;
      const gd = this.lastGoalDir ?? 1;
      if ((this.replayReason === 'goal' || this.replayReason === 'best') && (this.remote ? this.remoteProgress : this.replay.progress) > 0.6) {
        pos = new THREE.Vector3(gd * (PITCH.hl + GOAL.d + 1.2), 2.0, clamp(bp.z * 0.3, -3, 3));
        look = new THREE.Vector3(bp.x, 0.9, bp.z);
        k = 1 - Math.exp(-9 * dt);
      } else {
        pos = new THREE.Vector3(clamp(bp.x * 0.85, -22 * cs, 22 * cs), 8.5 * zoom * cs, 21 * zoom * cs);
        look = new THREE.Vector3(bp.x, 0.6, bp.z);
        k = 1 - Math.exp(-6 * dt);
      }
    } else if (sp && sp.type === 'penalty' && this.state === 'setpiece') {
      pos = new THREE.Vector3(sp.S.x - sp.d * 14 * zoom, 6.6 * zoom, 0);
      look = new THREE.Vector3(sp.G.x, 1.2, 0);
      fwd = { x: sp.d, z: 0 };
    } else if (mode === 'follow' || mode === 'ball') {
      // 'follow' keeps the selected player in the middle, 'ball' the ball (also when nobody is selected)
      const p = mode === 'follow' ? this.ctrls[0]?.player : null;
      const fx = p ? p.pos.x : b.x, fz = p ? p.pos.z : b.z;
      const fd = attackDir(p ? p.team : (this.ctrls[0]?.team ?? 0));
      pos = new THREE.Vector3(fx - 15 * zoom * fd, 9 * zoom, fz * 0.75);
      look = new THREE.Vector3(fx + 7 * fd, 0.5, fz * 0.8);
      fwd = { x: fd, z: 0 };
    } else if (mode === 'top') {
      pos = new THREE.Vector3(b.x * 0.5, 44 * zoom * PITCH.s, 4);
      look = new THREE.Vector3(b.x * 0.5, 0, 0);
      cam.up.set(0, 0, -1);
    } else {
      const tx = clamp(b.x * 0.8, -20 * cs, 20 * cs);
      pos = new THREE.Vector3(tx * 0.85, 17 * zoom * cs, 29 * zoom * cs);
      look = new THREE.Vector3(tx, 0, 1);
      if (this.cpuOnly && this.attract) pos.x += Math.sin(this.time * 0.2) * 8;
    }
    this.camForward = fwd;
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }
}
