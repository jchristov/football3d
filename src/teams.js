import { DIFFS } from './constants.js';
import { styleByKey } from './styles.js';
import { settings } from './settings.js';
import { lookFor, cleanName, SLOTS, SLOT_NUMBERS, SLOT_ROLES, CAPTAIN_SLOT } from './appearance.js';

export const TEAMS = [
  { style: 'possession', name: 'Blue Comets',   code: 'BLU', home: 0x1e6bff, trim: 0x0f45b8, pattern: 'stripes', away: 0xffffff, awayTrim: 0x1e6bff, shorts: 0xffffff, rating: 3 },
  { style: 'press', name: 'Red Rockets',   code: 'RED', home: 0xe4002b, trim: 0xa80020, pattern: 'hoops',   away: 0xffffff, awayTrim: 0xe4002b, shorts: 0xffffff, rating: 3 },
  { style: 'counter', name: 'Golden Lions',  code: 'GLD', home: 0xffc20e, trim: 0x222222, pattern: 'plain',   away: 0x222222, awayTrim: 0xffc20e, shorts: 0x222222, rating: 4 },
  { style: 'balanced', name: 'Green Dragons', code: 'GRN', home: 0x14b85a, trim: 0x0b7a3a, pattern: 'stripes', away: 0xffffff, awayTrim: 0x14b85a, shorts: 0xffffff, rating: 3 },
  { style: 'longball', name: 'Purple Storm',  code: 'PUR', home: 0x8e44ff, trim: 0x5b1fb8, pattern: 'hoops',   away: 0xffffff, awayTrim: 0x8e44ff, shorts: 0xffffff, rating: 4 },
  { style: 'counter', name: 'Orange Foxes',  code: 'ORA', home: 0xff7a1a, trim: 0xffffff, pattern: 'plain',   away: 0x222222, awayTrim: 0xff7a1a, shorts: 0x222222, rating: 2 },
  { style: 'press', name: 'Silver Wolves', code: 'SLV', home: 0xe6e9ef, trim: 0xb3bac8, pattern: 'stripes', away: 0x2a3550, awayTrim: 0xe6e9ef, shorts: 0x2a3550, rating: 5 },
  { style: 'possession', name: 'Sky Hawks',     code: 'SKY', home: 0x39b8f0, trim: 0x1d86b8, pattern: 'hoops',   away: 0x0d3b8a, awayTrim: 0x39b8f0, shorts: 0xffffff, rating: 2 },
];

const SURNAMES = ['Kovac', 'Moreau', 'Santos', 'Becker', 'Nakamura', 'Okafor', 'Lindqvist', 'Rossi', 'Duarte', 'Novak', 'Haas', 'Ivanov',
  'Silva', 'Keller', 'Mbeki', 'Larsen', 'Petrov', 'Costa', 'Weber', 'Torres', 'Fischer', 'Dubois', 'Horvat', 'Yilmaz', 'Andersen', 'Popescu',
  'Bauer', 'Jansen', 'Ricci', 'Varga', 'Ortega', 'Sato', 'Brandt', 'Lopez', 'Kuznetsov', 'Hansen', 'Meyer', 'Pavlov', 'Romano', 'Svoboda',
  'Diallo', 'Mercier', 'Almeida', 'Kaya', 'Nilsson', 'Berg', 'Alves', 'Stojanovic', 'Tanaka', 'Ferrari',
  'Mazur', 'Kowalski', 'Aydin', 'Ferreira', 'Lemaire', 'Johansson', 'Zielinski', 'Ortiz', 'Nagy', 'Vidal', 'Barros', 'Eriksson', 'Popov', 'Delgado',
  'Khalil', 'Rinaldi', 'Hoffmann', 'Moreno', 'Tomic', 'Wagner', 'Sorensen', 'Baptiste', 'Kruger', 'Medina',
  'Bianchi', 'Carvalho', 'Dragan', 'Eklund', 'Fontaine', 'Gruber', 'Hadzic', 'Ibarra', 'Jovanovic', 'Karlsson', 'Lazar', 'Marques',
  'Nowak', 'Oliveira', 'Pereira', 'Quintero', 'Rasmussen', 'Salazar', 'Thiel', 'Urban', 'Valdez', 'Winter', 'Xavier', 'Yamamoto',
  'Zimmer', 'Abreu', 'Brun', 'Cortez', 'Dumont', 'Engel', 'Farkas', 'Gallo', 'Hartmann', 'Ilic', 'Jaeger', 'Kemal', 'Lund', 'Mendes',
  'Naumann', 'Okoro', 'Petit', 'Quast', 'Reis', 'Strand', 'Toth', 'Uribe', 'Vogel', 'Wolff', 'Yildiz', 'Zeman',
  'Arnaud', 'Blanco', 'Cerny', 'Dietrich', 'Esposito', 'Falk', 'Grosu', 'Holm', 'Iglesias', 'Janko', 'Kovar', 'Leroy'];

// One fixed shuffle of the surname pool, so no two players in the game share a name
const NAME_ORDER = (() => {
  let seed = 20260410;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const a = [...SURNAMES];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
})();
// Players 1-8 of every team take the first 64 names, players 9-16 the next 64
const nameFor = (teamIdx, slot) => NAME_ORDER[slot < 8 ? teamIdx * 8 + slot : 64 + teamIdx * 8 + (slot - 8)];

// A player's speciality: how his game splits between defending, midfield play and attacking (percent, sums to 100).
// It follows his natural role with a little personal variation; goalkeepers are pure keepers.
// A well-mixed 32-bit hash, so neighbouring teams and slots get unrelated values
const mix32 = (x) => { x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };
const SPEC_BASE = { DEF: [60, 30, 10], MID: [20, 55, 25], FWD: [10, 30, 60] };
export function specialityFor(teamIdx, slot, role) {
  if (role === 'GK') {
    // Keepers are defenders by nature (all green); some have an extra quality: a sweeper-keeper who reads the game
    // (midfield) or a keeper with a long throw / kick (attack)
    const k = mix32(teamIdx * 17 + slot + 3), roll = k % 100;
    const mid = roll < 55 ? 0 : roll < 85 ? 10 + ((k >>> 8) % 11) : 8;
    const att = roll >= 85 ? 6 + ((k >>> 12) % 7) : 0;
    return { def: 100 - mid - att, mid, att, gk: true, main: 'GK' };
  }
  const h = Math.imul(teamIdx * 31 + slot + 7, 2654435761) >>> 0;
  const base = SPEC_BASE[role] || SPEC_BASE.MID;
  const dA = ((h >>> 3) % 21) - 10, dM = ((h >>> 11) % 17) - 8;
  let att = Math.max(5, base[2] + dA), mid = Math.max(5, base[1] + dM), def = 100 - att - mid;
  if (def < 5) { def = 5; mid = 100 - att - def; }
  const main = role === 'DEF' ? 'DEF' : role === 'FWD' ? 'FWD' : 'MID';
  return { def, mid, att, gk: false, main };
}

// Fixed, made-up squad for a team: 16 members. The first N play (N = team size), the next few are the bench.
// Each entry: { id, slot, num, name, role, look, captain }; editor overrides (name, looks) are applied here.
export function squad(teamIdx) {
  return Array.from({ length: SLOTS }, (_, slot) => {
    const custom = settings.custom?.[`${teamIdx}-${slot}`];
    return {
      id: `${teamIdx}-${slot}`,
      slot,
      num: SLOT_NUMBERS[slot],
      role: SLOT_ROLES[slot],
      spec: specialityFor(teamIdx, slot, SLOT_ROLES[slot]),
      name: cleanName(custom?.name) || nameFor(teamIdx, slot).toUpperCase(),
      look: lookFor(teamIdx, slot),
      captain: slot === CAPTAIN_SLOT,
    };
  });
}

// The play style of a CPU team
export const styleOfTeam = (idx) => styleByKey(TEAMS[idx]?.style);

export const squadName = (teamIdx, slot) => squad(teamIdx)[slot].name;

const GK_KITS = [0xf2e52e, 0x14b85a, 0xff5fb8, 0x151515];

const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
export const colorDist = (a, b) => {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
};

// Kits for both sides: the second team switches to its away shirt on a colour clash,
// and each goalkeeper gets the colour that is furthest from both outfield shirts.
export function pickKits(t0, t1) {
  const a = TEAMS[t0], b = TEAMS[t1];
  const clash = colorDist(a.home, b.home) < 110;
  const home = (t) => ({ shirt: t.home, trim: t.trim, pattern: t.pattern, shorts: t.shorts, sock: t.home });
  const away = (t) => ({ shirt: t.away, trim: t.awayTrim, pattern: 'plain', shorts: t.away === 0xffffff ? 0x333333 : t.shorts, sock: t.away });
  const outfield = [home(a), clash ? away(b) : home(b)];
  const used = [];
  const gk = [0, 1].map(() => {
    let best = GK_KITS[0], bs = -1;
    for (const c of GK_KITS) {
      if (used.includes(c)) continue;
      const s = Math.min(colorDist(c, outfield[0].shirt), colorDist(c, outfield[1].shirt));
      if (s > bs) { bs = s; best = c; }
    }
    used.push(best);
    return { shirt: best, trim: best, pattern: 'plain', shorts: 0x1a1a1a, sock: best };
  });
  return { outfield, gk };
}

// CPU skill: chosen difficulty adjusted by the team rating (1-5, 3 = neutral)
export function makeDiff(diffKey, rating = 3) {
  const d = DIFFS[diffKey], k = rating - 3;
  return {
    ...d,
    speed: d.speed + k * 0.025,
    react: Math.max(0.08, d.react * (1 - k * 0.1)),
    save: Math.min(0.92, d.save + k * 0.05),
    tackle: Math.min(0.9, d.tackle + k * 0.05),
    shootRange: d.shootRange + k * 0.8,
  };
}

const rnd = (n) => Math.floor(Math.random() * n);
function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = rnd(i + 1); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

// Quick-sim of a fixture the player isn't involved in.
// Returns [goalsA, goalsB, pensWinner|null]; knockout games are never drawn.
export function simulateMatch(a, b, knockout) {
  const lam = (x, y) => Math.max(0.6, 2.0 + (TEAMS[x].rating - TEAMS[y].rating) * 0.35);
  const poisson = (l) => { let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= Math.random(); } while (p > L); return k - 1; };
  let ga = poisson(lam(a, b)), gb = poisson(lam(b, a)), pens = null;
  if (knockout && ga === gb) {
    const pa = 0.5 + (TEAMS[a].rating - TEAMS[b].rating) * 0.05;
    pens = Math.random() < pa ? 0 : 1;
  }
  return [ga, gb, pens];
}

// Cards of the user's team over a cup / league: a red card means a one-match ban, so does the third yellow card
// (the yellow count then starts again).
export const YELLOWS_FOR_BAN = 3;
export class Discipline {
  constructor() { this.yellows = {}; this.reds = {}; this.suspended = []; this.injured = []; } // squad slot -> count; slots banned for the next match

  // report: { yellows: { slot: n }, sent: [slot, ...] } of the match that was just played
  record(report = {}) {
    this.suspended = []; // the ban was served by missing this match
    this.injured = [...(report.injured || [])]; // players hurt in this match miss the next one
    const sent = new Set(report.sent || []);
    for (const slot of sent) { this.reds[slot] = (this.reds[slot] || 0) + 1; this.suspended.push(slot); }
    for (const [k, n] of Object.entries(report.yellows || {})) {
      const slot = Number(k);
      if (sent.has(slot)) continue; // a second yellow is just the red card
      this.yellows[slot] = (this.yellows[slot] || 0) + n;
      if (this.yellows[slot] >= YELLOWS_FOR_BAN) { this.yellows[slot] -= YELLOWS_FOR_BAN; if (!this.suspended.includes(slot)) this.suspended.push(slot); }
    }
    return this.suspended;
  }

  // Everybody who cannot play the next match
  unavailable() { return [...new Set([...this.suspended, ...this.injured])]; }

  // Rows for the discipline table: players with a card or a ban
  rows() {
    const slots = new Set([...Object.keys(this.yellows), ...Object.keys(this.reds)].map(Number));
    for (const s of this.suspended) slots.add(s);
    for (const s of this.injured) slots.add(s);
    return [...slots].sort((a, b) => a - b).map((slot) => ({ slot, yellows: this.yellows[slot] || 0, reds: this.reds[slot] || 0, banned: this.suspended.includes(slot), injured: this.injured.includes(slot) }))
      .filter((r) => r.yellows || r.reds || r.banned || r.injured);
  }
}

export class Tournament {
  // kind: 'cup' (8-team knockout) | 'league' (6-team round robin)
  // opts (league): { opponents: [5 team indexes], legs: 1 | 2 (home and away) }
  constructor(kind, userTeam, diffKey, opts = {}) {
    this.kind = kind;
    this.user = userTeam;
    this.diffKey = diffKey;
    this.over = false;
    this.discipline = new Discipline();
    this.round = 0;
    this.history = [];
    const others = shuffle(TEAMS.map((_, i) => i).filter((i) => i !== userTeam));
    if (kind === 'cup') {
      this.teams = shuffle([userTeam, ...others.slice(0, 7)]);
      this.rounds = ['Quarter-final', 'Semi-final', 'Final'];
      this.fixtures = this.pairUp(this.teams);
      this.alive = [...this.teams];
    } else {
      this.teams = [userTeam, ...(opts.opponents || others.slice(0, 5))];
      this.table = Object.fromEntries(this.teams.map((t) => [t, { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 }]));
      this.schedule = this.roundRobin(this.teams);
      this.legs = opts.legs === 2 ? 2 : 1;
      if (this.legs === 2) this.schedule = [...this.schedule, ...this.schedule.map((r) => r.map((f) => ({ a: f.b, b: f.a })))]; // the return leg: home and away swapped
      this.rounds = this.schedule.map((_, i) => `Matchday ${i + 1}`);
      this.fixtures = this.schedule[0];
    }
  }

  pairUp(list) { const f = []; for (let i = 0; i < list.length; i += 2) f.push({ a: list[i], b: list[i + 1] }); return f; }

  roundRobin(teams) {
    const list = [...teams], n = list.length, rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const fx = [];
      for (let i = 0; i < n / 2; i++) fx.push({ a: list[i], b: list[n - 1 - i] });
      rounds.push(fx);
      list.splice(1, 0, list.pop());
    }
    return rounds;
  }

  // Plain data for saving (the career mode keeps a league between sessions)
  toJSON() {
    const { fixtures, ...rest } = this; // the current fixtures are the schedule entry of the current round
    return { ...rest, discipline: { ...this.discipline } };
  }

  static fromJSON(o) {
    const t = Object.assign(Object.create(Tournament.prototype), o);
    t.discipline = Object.assign(new Discipline(), o.discipline);
    t.fixtures = t.schedule[Math.min(t.round, t.schedule.length - 1)];
    return t;
  }

  get roundName() { return this.rounds[this.round]; }
  get knockout() { return this.kind === 'cup'; }

  // The user's fixture for the current round, with the user's team first
  get userFixture() {
    const f = this.fixtures.find((x) => x.a === this.user || x.b === this.user);
    return f ? { opponent: f.a === this.user ? f.b : f.a } : null;
  }

  // result: { score: [user, opp], winner: 0|1|null }
  report(result) {
    const uf = this.fixtures.find((x) => x.a === this.user || x.b === this.user);
    const results = [];
    const userIsA = uf && uf.a === this.user;
    for (const f of this.fixtures) {
      let ga, gb, pw = null;
      if (f === uf) {
        [ga, gb] = userIsA ? result.score : [result.score[1], result.score[0]];
        if (result.winner !== null && result.score[0] === result.score[1]) pw = (result.winner === 0) === userIsA ? 0 : 1;
      } else [ga, gb, pw] = simulateMatch(f.a, f.b, this.knockout);
      f.result = { ga, gb, pw };
      results.push(f);
      if (this.kind === 'league') this.record(f.a, f.b, ga, gb);
    }
    this.history.push({ round: this.roundName, fixtures: this.fixtures.map((f) => ({ ...f })) });

    if (this.kind === 'cup') {
      const winners = this.fixtures.map((f) => (f.result.ga > f.result.gb || f.result.pw === 0 ? f.a : f.b));
      this.userOut = !winners.includes(this.user);
      if (this.userOut) { this.over = true; this.champion = null; }
      else if (winners.length === 1) { this.over = true; this.champion = winners[0]; }
      else { this.fixtures = this.pairUp(winners); this.round++; }
    } else {
      this.round++;
      if (this.round >= this.schedule.length) { this.over = true; this.champion = this.standings()[0].team; } else this.fixtures = this.schedule[this.round];
    }
    return results;
  }

  record(a, b, ga, gb) {
    const A = this.table[a], B = this.table[b];
    A.gf += ga; A.ga += gb; B.gf += gb; B.ga += ga;
    if (ga > gb) { A.w++; A.p += 3; B.l++; } else if (ga < gb) { B.w++; B.p += 3; A.l++; } else { A.d++; B.d++; A.p++; B.p++; }
  }

  standings() {
    return this.teams.map((t) => ({ team: t, ...this.table[t] }))
      .sort((x, y) => y.p - x.p || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
  }
}
