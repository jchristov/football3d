import { PITCH, GOAL, attackDir } from './constants.js';

export const HEAT_W = 24, HEAT_H = 15; // heat map grid: attack direction is always +x

// Where on the pitch, from the point of view of the attacking direction: -1..1 along the pitch (+1 = the goal attacked)
// and -1..1 across
export const normPos = (p) => ({ x: Math.max(-1, Math.min(1, (p.pos.x * attackDir(p.team)) / PITCH.hl)), z: Math.max(-1, Math.min(1, p.pos.z / PITCH.hw)) });

// Match statistics for both sides (index 0 = home / player 1)
export class Stats {
  constructor() { this.reset(); }

  reset() {
    this.enabled = true;
    this.poss = [0, 0];
    this.shots = [0, 0];
    this.onTarget = [0, 0];
    this.passes = [0, 0];
    this.passesOk = [0, 0];
    this.saves = [0, 0];
    this.tackles = [0, 0];
    this.headers = [0, 0];
    this.offsides = [0, 0];
    this.corners = [0, 0];
    this.yellows = [0, 0];
    this.reds = [0, 0];
    this.goals = [];
    this.pending = null;
    this.players = new Map(); // `${team}-${squad slot}` -> what that player did (see ratings.js)
    this.heat = [new Float32Array(HEAT_W * HEAT_H), new Float32Array(HEAT_W * HEAT_H)]; // seconds spent per pitch cell
    this.shotLog = []; // every shot: { team, key, x, z, on, goal, t }
    this.pairs = new Map(); // `${team}-${from slot}>${to slot}` -> completed passes between two players
    this.lastPass = null; // the latest completed pass, for assists
  }

  // The record of a player (created on first sight); identity is the squad member, not the pitch slot
  rec(p) {
    const key = `${p.team}-${p.squadSlot}`;
    let r = this.players.get(key);
    if (!r) {
      r = { key, team: p.team, slot: p.squadSlot, num: p.num, name: p.name, role: p.spec?.main || p.role, spec: p.spec, seconds: 0, meters: 0, sx: 0, sz: 0, samples: 0, touches: 0, passes: 0, passesOk: 0, shots: 0, onTarget: 0, goals: 0, assists: 0, ownGoals: 0, tackles: 0, saves: 0, headers: 0, fouls: 0, yellows: 0, reds: 0 };
      this.players.set(key, r);
    }
    return r;
  }

  // Time on the pitch, distance run, heat map and average position of every player
  tickPlayers(players, dt) {
    if (!this.enabled) return;
    for (const p of players) {
      const r = this.rec(p), n = normPos(p);
      r.seconds += dt; r.meters += (p.speed || 0) * dt;
      r.sx += n.x; r.sz += n.z; r.samples++;
      const gx = Math.min(HEAT_W - 1, Math.floor(((n.x + 1) / 2) * HEAT_W)), gz = Math.min(HEAT_H - 1, Math.floor(((n.z + 1) / 2) * HEAT_H));
      this.heat[p.team][gz * HEAT_W + gx] += dt;
    }
  }
  recTackle(p) { if (this.enabled) this.rec(p).tackles++; }
  recSave(p) { if (this.enabled) this.rec(p).saves++; }
  recHeader(p) { if (this.enabled) this.rec(p).headers++; }
  recFoul(p) { if (this.enabled) this.rec(p).fouls++; }
  recCard(p, kind) { if (!this.enabled) return; const r = this.rec(p); if (kind === 'yellow' || kind === 'second') r.yellows++; if (kind !== 'yellow') r.reds++; }

  // A goal: the scorer (or the own-goal player) and, for a real goal, the team-mate who passed to him a moment ago
  recGoal(scorer, own, time) {
    if (!this.enabled || !scorer) return;
    const r = this.rec(scorer);
    if (own) { r.ownGoals++; return; }
    r.goals++;
    for (let i = this.shotLog.length - 1; i >= 0; i--) { const e = this.shotLog[i]; if (e.key === r.key && time - e.t < 6) { e.goal = true; break; } }
    const lp = this.lastPass;
    if (lp && lp.to === scorer && lp.from !== scorer && time - lp.time < 6) this.rec(lp.from).assists++;
  }

  tick(team, dt) { if (this.enabled && team >= 0) this.poss[team] += dt; }

  // Judge a kick as a shot from where it will cross the goal line
  shot(p, angle, speed, time = 0) {
    if (!this.enabled) return null;
    const dir = attackDir(p.team), gx = dir * PITCH.hl;
    const vx = Math.cos(angle) * speed;
    if (vx * dir < 3 || speed < 12 || Math.abs(gx - p.pos.x) > 30 * Math.sqrt(PITCH.s)) return null;
    const t = (gx - p.pos.x) / vx;
    const zLine = p.pos.z + Math.sin(angle) * speed * t;
    const onTarget = Math.abs(zLine) < GOAL.hw;
    if (Math.abs(zLine) > GOAL.hw + 4) return null;
    this.shots[p.team]++;
    const pr = this.rec(p); pr.shots++;
    const np = normPos(p);
    this.shotLog.push({ team: p.team, key: pr.key, name: p.name, num: p.num, x: np.x, z: np.z, on: onTarget, goal: false, t: time });
    if (onTarget) { this.onTarget[p.team]++; pr.onTarget++; }
    return { onTarget, dist: Math.abs(gx - p.pos.x) };
  }

  pass(p) {
    if (!this.enabled) return;
    this.passes[p.team]++;
    this.rec(p).passes++;
    this.pending = { team: p.team, from: p };
  }

  // Called whenever a player touches the ball
  touch(p, time = 0) {
    if (this.enabled) this.rec(p).touches++;
    const pd = this.pending;
    if (!pd || p === pd.from) return;
    if (p.team === pd.team) {
      this.passesOk[pd.team]++; this.rec(pd.from).passesOk++; this.lastPass = { from: pd.from, to: p, time };
      const k = `${pd.team}-${pd.from.squadSlot}>${p.squadSlot}`;
      this.pairs.set(k, (this.pairs.get(k) || 0) + 1);
    }
    this.pending = null;
  }

  possession() {
    const t = this.poss[0] + this.poss[1];
    return t > 0 ? [Math.round((this.poss[0] / t) * 100), 100 - Math.round((this.poss[0] / t) * 100)] : [50, 50];
  }

  // Rows for the stats table: [label, left, right, leftShare 0..1]
  rows(fouls, opts = {}) {
    const pc = this.possession();
    const acc = (t) => (this.passes[t] ? Math.round((this.passesOk[t] / this.passes[t]) * 100) : 0);
    const share = (a, b) => (a + b > 0 ? a / (a + b) : 0.5);
    return [
      ['Possession', `${pc[0]}%`, `${pc[1]}%`, pc[0] / 100],
      ['Shots', this.shots[0], this.shots[1], share(this.shots[0], this.shots[1])],
      ['On target', this.onTarget[0], this.onTarget[1], share(this.onTarget[0], this.onTarget[1])],
      ['Passes', `${this.passes[0]} (${acc(0)}%)`, `${this.passes[1]} (${acc(1)}%)`, share(this.passes[0], this.passes[1])],
      ['Tackles won', this.tackles[0], this.tackles[1], share(this.tackles[0], this.tackles[1])],
      ['Headers', this.headers[0], this.headers[1], share(this.headers[0], this.headers[1])],
      ['Saves', this.saves[0], this.saves[1], share(this.saves[0], this.saves[1])],
      ['Fouls', fouls[0], fouls[1], share(fouls[0], fouls[1])],
      ...(this.corners[0] + this.corners[1] > 0 ? [['Corners', this.corners[0], this.corners[1], share(this.corners[0], this.corners[1])]] : []),
      ...(this.yellows[0] + this.yellows[1] > 0 ? [['Yellow cards', this.yellows[0], this.yellows[1], share(this.yellows[0], this.yellows[1])]] : []),
      ...(this.reds[0] + this.reds[1] > 0 ? [['Red cards', this.reds[0], this.reds[1], share(this.reds[0], this.reds[1])]] : []),
      ...(opts.offside ? [['Offsides', this.offsides[0], this.offsides[1], share(this.offsides[0], this.offsides[1])]] : []),
    ];
  }
}
