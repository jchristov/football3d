import { Tournament, TEAMS, squad } from './teams.js';

// Career mode: a league season (home and away) after another with the same squad. The squad keeps its cards, injuries and
// form between matches, every player collects appearances, goals, assists and ratings, and the whole league has a top-scorers
// table. A win in a season makes the next one harder. Everything is saved after each match.
const KEY = 'football3d.career';
const store = () => (typeof localStorage !== 'undefined' ? localStorage : null);
const DIFF_ORDER = ['kids', 'beginner', 'easy', 'normal', 'hard', 'expert'];
const MAX_FORM = 5;

const line = () => ({ apps: 0, goals: 0, assists: 0, yellows: 0, reds: 0, ratings: [] });
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// How likely each squad member is to score in a simulated match: forwards first, goalkeepers almost never
const SCORE_WEIGHT = { FWD: 5, MID: 2, DEF: 0.6, GK: 0.03 };
const REGULARS = 8; // the CPU squads rotate among their first 8 members

export const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

export class Career {
  constructor(user, diffKey, opponents) {
    this.user = user;
    this.diffKey = diffKey;
    this.opponents = opponents || shuffle(TEAMS.map((_, i) => i).filter((i) => i !== user)).slice(0, 5);
    this.season = 1;
    this.squad = {}; // user squad slot -> this season's line
    this.total = {}; // user squad slot -> the whole career
    this.scorers = {}; // `${team}-${slot}` -> { team, slot, goals } of the league this season
    this.results = []; // the user's results: { season, md, opp, gf, ga }
    this.seasons = []; // finished seasons
    this.tour = this.newTour();
  }

  newTour() { return new Tournament('league', this.user, this.diffKey, { opponents: shuffle(this.opponents), legs: 2 }); }

  // ---------- saving ----------
  toJSON() { return { ...this }; }
  static fromJSON(o) {
    const c = Object.assign(Object.create(Career.prototype), o);
    c.tour = Tournament.fromJSON(o.tour);
    return c;
  }
  static load() {
    try {
      const raw = store()?.getItem(KEY);
      if (!raw) return null;
      const c = Career.fromJSON(JSON.parse(raw));
      return Number.isInteger(c.user) && c.tour?.schedule ? c : null;
    } catch { return null; }
  }
  save() { try { store()?.setItem(KEY, JSON.stringify(this)); } catch { /* storage full or blocked */ } }
  static clear() { try { store()?.removeItem(KEY); } catch { /* ignore */ } }

  // ---------- recording ----------
  // A played match of the user's team (always team 0 in the result)
  recordMatch(result, opp) {
    const [gf, ga] = result.score;
    this.results.push({ season: this.season, md: this.tour.round + 1, opp, gf, ga });
    this.results = this.results.slice(-60);
    for (const r of result.ratings || []) {
      const team = r.team === 0 ? this.user : opp;
      if (r.goals) this.addScorer(team, r.slot, r.goals);
      if (r.team !== 0) continue;
      for (const book of [this.squad, this.total]) {
        const l = (book[r.slot] ||= line());
        l.apps++; l.goals += r.goals; l.assists += r.assists; l.yellows += r.yellows; l.reds += r.reds;
        l.ratings.push(r.rating);
        if (book === this.total) l.ratings = l.ratings.slice(-30);
      }
    }
  }

  addScorer(team, slot, n = 1) {
    const e = (this.scorers[`${team}-${slot}`] ||= { team, slot, goals: 0 });
    e.goals += n;
  }

  // The other fixtures of the round just played are simulated: hand their goals out to players
  recordRound(rnd = Math.random) {
    const last = this.tour.history[this.tour.history.length - 1];
    if (!last) return;
    for (const f of last.fixtures) {
      if (f.a === this.user || f.b === this.user || !f.result) continue;
      for (const [team, n] of [[f.a, f.result.ga], [f.b, f.result.gb]]) for (let i = 0; i < n; i++) this.addScorer(team, this.pickScorer(team, rnd));
    }
  }

  pickScorer(team, rnd = Math.random) {
    const sq = squad(team).slice(0, REGULARS), w = sq.map((m) => SCORE_WEIGHT[m.role] ?? 1);
    let x = rnd() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < sq.length; i++) { x -= w[i]; if (x <= 0) return sq[i].slot; }
    return sq[sq.length - 1].slot;
  }

  // ---------- reading ----------
  // The league's top scorers: [{ team, slot, name, num, goals, mine }]
  topScorers(n = 8) {
    return Object.values(this.scorers)
      .sort((a, b) => b.goals - a.goals || a.team - b.team || a.slot - b.slot).slice(0, n)
      .map((e) => { const m = squad(e.team)[e.slot]; return { ...e, name: m.name, num: m.num, mine: e.team === this.user, assists: e.team === this.user ? this.squad[e.slot]?.assists || 0 : null }; });
  }

  // The results of the user's team, newest last: 'W' | 'D' | 'L'
  userForm(n = MAX_FORM) {
    return this.results.slice(-n).map((r) => (r.gf > r.ga ? 'W' : r.gf < r.ga ? 'L' : 'D'));
  }

  // Average mark of the last `n` matches of a squad member (null without any)
  recentRating(slot, n = 3) {
    const r = this.total[slot]?.ratings || [];
    return r.length ? avg(r.slice(-n)) : null;
  }

  // 'hot' | 'cold' | null: a good or poor run of marks
  formState(slot) {
    const r = this.total[slot]?.ratings || [];
    if (r.length < 2) return null;
    const a = avg(r.slice(-3));
    return a >= 7.4 ? 'hot' : a <= 5.6 ? 'cold' : null;
  }

  // Skill multipliers for the next match: players in form play a little better, those out of form a little worse
  formMul() {
    const out = {};
    for (const slot of Object.keys(this.total)) {
      const r = this.total[slot].ratings;
      if (r.length < 2) continue;
      const a = avg(r.slice(-3));
      const m = a >= 7.4 ? 1.05 : a >= 6.8 ? 1.02 : a <= 5.6 ? 0.95 : a <= 6.0 ? 0.98 : 1;
      if (m !== 1) out[slot] = m;
    }
    return out;
  }

  // The user's squad for the table: one row per member who has played this season or in the career
  squadRows() {
    return squad(this.user).map((m) => {
      const s = this.squad[m.slot] || line(), t = this.total[m.slot] || line();
      return { slot: m.slot, num: m.num, name: m.name, role: m.role, apps: s.apps, goals: s.goals, assists: s.assists, rating: s.ratings.length ? avg(s.ratings) : null,
        yellows: s.yellows, reds: s.reds, form: this.formState(m.slot), careerApps: t.apps, careerGoals: t.goals };
    }).filter((r) => r.apps || r.careerApps || r.slot < 8);
  }

  // ---------- seasons ----------
  // Close the finished season: the summary that is kept in the history
  endSeason() {
    const t = this.tour, table = t.standings();
    const pos = table.findIndex((r) => r.team === this.user) + 1, me = table[pos - 1];
    const gold = this.topScorers(1)[0] || null;
    const pots = this.squadRows().filter((r) => r.apps >= 3 && r.rating !== null).sort((a, b) => b.rating - a.rating)[0] || null;
    const entry = {
      season: this.season, pos, pts: me.p, gd: me.gf - me.ga, champion: table[0].team, diffKey: this.diffKey,
      gold: gold && { name: gold.name, team: gold.team, goals: gold.goals },
      pots: pots && { name: pots.name, rating: Math.round(pots.rating * 10) / 10 },
    };
    this.seasons.push(entry);
    return entry;
  }

  // Start the next season with the same squad (fresh league, new fixture list); a title makes the CPU play harder.
  // Returns a note for the player when the difficulty went up.
  nextSeason() {
    const last = this.seasons[this.seasons.length - 1];
    let note = '';
    const i = DIFF_ORDER.indexOf(this.diffKey);
    if (last?.pos === 1 && i >= 0 && i < DIFF_ORDER.length - 1) { this.diffKey = DIFF_ORDER[i + 1]; note = `Champions! The league is harder now: ${this.diffKey}.`; }
    this.season++;
    this.squad = {};
    this.scorers = {};
    this.tour = this.newTour();
    return note;
  }
}
