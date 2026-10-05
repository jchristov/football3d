import { squad } from './teams.js';
import { homeSlots, formationOf, pressOf, cpuTactics, resolveFormation, DEFAULT_TACTICS } from './tactics.js';
import { MATCH, benchSize } from './constants.js';
import { TEAMS, styleOfTeam } from './teams.js';

export const MAX_SUBS = 5;
const BENCH_RECOVERY = 0.012; // energy regained per second while resting on the bench

// Per-team squad management for a match: who is on the pitch, who is on the bench, energy of everybody,
// tactics, and substitutions. Player objects stay the five fixed "slots" on the pitch; a substitution changes
// which squad member stands in a slot.
export class Lineups {
  constructor(game) {
    this.game = game;
    this.rosters = [[], []];
    this.size = 5; // players per team on the pitch
    this.onPitch = [[0, 1, 2, 3, 4], [0, 1, 2, 3, 4]]; // squad slot per pitch index (index 0 = goalkeeper)
    this.bench = [[5, 6, 7], [5, 6, 7]];
    this.energy = [new Map(), new Map()]; // energy of squad members who are currently off the pitch
    this.subs = [0, 0];
    this.tactics = [{ ...DEFAULT_TACTICS }, { ...DEFAULT_TACTICS }];
    this.yellows = [new Map(), new Map()]; // squad slot -> yellow cards shown (a second one is a red)
    this.fouls = [new Map(), new Map()]; // squad slot -> fouls committed (repeat offenders are booked more often)
    this.sentOff = [new Set(), new Set()]; // squad slots that received a red card
    this.dead = [new Set(), new Set()]; // pitch indexes that are empty because of a red card
    this.injured = [new Set(), new Set()]; // squad slots injured during this match
    this.unavailable = [new Set(), new Set()]; // squad slots that cannot play this match (suspended, injured)
    this.form = [new Map(), new Map()]; // squad slot -> skill multiplier from the career form (1 = normal)
  }

  // Fresh squads for both teams (team indexes into TEAMS)
  reset(teamIdx, size = MATCH.size) {
    this.size = size;
    const bench = benchSize(size);
    for (let t = 0; t < 2; t++) {
      this.rosters[t] = squad(teamIdx[t]);
      // available players in squad order: the first N start, the next ones are on the bench
      const order = this.rosters[t].map((m) => m.slot).filter((s) => !this.unavailable[t].has(s));
      this.onPitch[t] = order.slice(0, size);
      this.bench[t] = order.slice(size, size + bench);
      this.energy[t].clear();
      this.subs[t] = 0;
      this.yellows[t].clear(); this.fouls[t].clear(); this.sentOff[t].clear(); this.dead[t].clear(); this.injured[t].clear();
    }
  }

  // Seat the squad where the natural roles fit the formation (a defender in a defender's slot ...): the best-fitting players
  // of the whole squad start, the rest sit on the bench. Only done at kick-off: during a match the Player objects keep
  // their energy, so nobody is moved around then.
  autoAssign(team) {
    const slots = homeSlots(this.tactics[team].formation, this.size), roster = this.rosters[team];
    const bench = this.bench[team].length;
    const pool = [...this.onPitch[team].slice(1), ...this.bench[team]].sort((a, b) => a - b), result = [this.onPitch[team][0]];
    for (let i = 1; i < this.size && pool.length; i++) {
      let k = pool.findIndex((s) => roster[s].spec?.main === slots[i].role);
      if (k < 0) k = 0;
      result.push(pool.splice(k, 1)[0]);
    }
    this.onPitch[team] = result;
    this.bench[team] = pool.slice(0, bench);
  }

  // Re-read names / looks (the squad editor may have changed them) without touching who is on the pitch
  refreshRosters(teamIdx) {
    for (let t = 0; t < 2; t++) this.rosters[t] = squad(teamIdx[t]);
  }

  setTactics(team, tactics) {
    this.tactics[team] = { ...DEFAULT_TACTICS, ...tactics };
  }

  // Default tactics for a match: the player's choice for human-controlled sides, rating-based for the CPU
  initTactics(userTactics, humanTeams, teamIdx) {
    for (let t = 0; t < 2; t++) {
      this.tactics[t] = humanTeams.includes(t) ? { ...DEFAULT_TACTICS, ...(Array.isArray(userTactics) ? userTactics[t] : userTactics) } : cpuTactics(TEAMS[teamIdx[t]].rating, this.size, styleOfTeam(teamIdx[t]));
      this.tactics[t].formation = resolveFormation(this.tactics[t].formation, this.size);
    }
  }

  // Put each pitch slot into the formation: role, home position, and the matching pressing parameters
  applyFormation(team) {
    const g = this.game, slots = homeSlots(this.tactics[team].formation, this.size), press = pressOf(this.tactics[team]);
    g.teams[team].forEach((p) => {
      const i = p.index;
      p.role = slots[i].role;
      p.home = { lx: slots[i].lx, lz: slots[i].lz };
      p.drainMul = i === 0 ? 1 : press.drain || 1;
    });
  }

  // Put the squad member of each pitch slot onto its Player
  applyIdentities(team) {
    const g = this.game, roster = this.rosters[team];
    const captain = this.captainPitchIndex(team);
    g.teams[team].forEach((p) => {
      const m = roster[this.onPitch[team][p.index]];
      p.setIdentity(m.num, m.name, m.look, p.index === captain, m.id);
      p.squadSlot = m.slot;
      p.spec = m.spec;
      p.yellows = this.yellows[team].get(m.slot) || 0;
      p.injured = this.injured[team].has(m.slot);
      p.form = this.form[team].get(m.slot) ?? 1;
    });
  }

  // The armband stays with the captain; if he is on the bench it passes to the first outfield player
  captainPitchIndex(team) {
    const roster = this.rosters[team], on = this.onPitch[team];
    const c = on.findIndex((s, i) => roster[s].captain && !this.dead[team].has(i));
    if (c >= 0) return c;
    for (let i = 1; i < on.length; i++) if (!this.dead[team].has(i)) return i;
    return 1;
  }

  member(team, pitchIdx) { return this.rosters[team][this.onPitch[team][pitchIdx]]; }
  benchMember(team, k) { return this.rosters[team][this.bench[team][k]]; }

  energyOf(team, squadSlot) {
    const idx = this.onPitch[team].indexOf(squadSlot);
    if (idx >= 0) return this.game.pool[team][idx].energy;
    return this.energy[team].get(squadSlot) ?? 1;
  }

  // The bench player who should come on for an injured one: the freshest fit player
  bestBenchIndex(team) {
    let bk = -1, be = -1;
    this.bench[team].forEach((slot, k) => { if (this.injured[team].has(slot)) return; const e = this.energy[team].get(slot) ?? 1; if (e > be) { be = e; bk = k; } });
    return bk;
  }

  canSub(team) { return this.subs[team] < MAX_SUBS; }

  // Swap the player in pitch slot `pitchIdx` (outfield only) with bench position `benchK`
  substitute(team, pitchIdx, benchK) {
    if (pitchIdx < 1 || pitchIdx >= this.size || this.dead[team].has(pitchIdx) || benchK < 0 || benchK >= this.bench[team].length || !this.canSub(team)) return null;
    const g = this.game, p = g.pool[team][pitchIdx];
    const outSlot = this.onPitch[team][pitchIdx], inSlot = this.bench[team][benchK];
    if (this.injured[team].has(inSlot)) return null; // an injured player cannot come on
    const out = this.rosters[team][outSlot], inn = this.rosters[team][inSlot];
    this.energy[team].set(outSlot, p.energy);
    p.energy = this.energy[team].get(inSlot) ?? 1;
    p.stamina = 1;
    this.energy[team].delete(inSlot);
    this.onPitch[team][pitchIdx] = inSlot;
    this.bench[team][benchK] = outSlot;
    this.subs[team]++;
    this.applyIdentities(team);
    // a human controlling the replaced player gets the newcomer
    for (const c of g.ctrls) if (c.team === team && c.player === p) c.reset();
    return { out, in: inn };
  }

  // ---------- injuries ----------
  isInjured(team, slot) { return this.injured[team].has(slot); }
  injure(team, slot) {
    this.injured[team].add(slot);
    for (const p of this.game.teams[team]) if (p.squadSlot === slot) p.injured = true;
  }

  // ---------- discipline ----------
  // What the tournament needs to know after a match: yellow cards (slot -> count) and sent-off squad slots of `team`
  disciplineReport(team) {
    const yellows = {};
    for (const [slot, n] of this.yellows[team]) if (n > 0) yellows[slot] = n;
    return { yellows, sent: [...this.sentOff[team]], injured: [...this.injured[team]] };
  }

  playersOn(team) { return this.size - this.dead[team].size; }

  // A team is never reduced below this many players (7 of 11, 3 of 5, 2 of 3 ...); further offences only earn yellow cards
  minPlayers() { return Math.max(2, Math.round(this.size * 0.64)); }

  canSendOff(team) { return this.playersOn(team) > this.minPlayers(); }

  yellowsOf(team, slot) { return this.yellows[team].get(slot) || 0; }
  foulsOf(team, slot) { return this.fouls[team].get(slot) || 0; }
  noteFoul(team, slot) { this.fouls[team].set(slot, this.foulsOf(team, slot) + 1); }

  // Show a yellow card to the member of squad `slot`; returns how many he now has
  book(team, slot) {
    const n = Math.min(2, this.yellowsOf(team, slot) + 1);
    this.yellows[team].set(slot, n);
    for (const p of this.game.teams[team]) if (p.squadSlot === slot) p.yellows = n;
    return n;
  }

  // Send the player on pitch index `pitchIdx` off. A sent-off goalkeeper is replaced in goal by the last outfield
  // player, who is the one that actually leaves the pitch. Returns { out, keeper } (keeper = the new goalkeeper, if any).
  sendOff(team, pitchIdx) {
    const g = this.game, on = this.onPitch[team], roster = this.rosters[team];
    const out = roster[on[pitchIdx]];
    this.sentOff[team].add(out.slot);
    let keeper = null, gone = pitchIdx;
    if (pitchIdx === 0) {
      let k = -1;
      for (let i = on.length - 1; i >= 1; i--) if (!this.dead[team].has(i)) { k = i; break; }
      if (k < 0) return null;
      [on[0], on[k]] = [on[k], on[0]];
      const gk = g.pool[team][0], pk = g.pool[team][k];
      [gk.energy, pk.energy] = [pk.energy, gk.energy];
      keeper = roster[on[0]];
      gone = k;
    }
    this.dead[team].add(gone);
    g.removePlayer(g.pool[team][gone]);
    this.applyIdentities(team);
    return { out, keeper };
  }

  // Bench players recover while they wait
  tickBench(dt) {
    for (let t = 0; t < 2; t++) for (const [slot, e] of this.energy[t]) this.energy[t].set(slot, Math.min(1, e + BENCH_RECOVERY * dt));
  }
}

export { formationOf, pressOf };
