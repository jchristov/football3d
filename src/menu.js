import { TEAMS, Tournament, squad } from './teams.js';
import { Career } from './career.js';
import { formGuideHtml, scorersHtml, squadHtml, seasonsHtml, seasonSummaryHtml } from './careerui.js';
import { settings, onSettings } from './settings.js';
import { buildBallPicker, buildBallSizePicker } from './ballpicker.js';
import { settings as S, saveSettings } from './settings.js';
import { formationsFor, resolveFormation, PRESS, PRESS_KEYS } from './tactics.js';
import { TEAM_SIZES } from './constants.js';
import { tint, tn } from './teamcolor.js';
import { styleByKey } from './styles.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
const CHOICES = { mode: ['1p', '2p', 'cpu', 'online'], comp: ['friendly', 'cup', 'league', 'career'], diff: ['easy', 'normal', 'hard'], time: ['day', 'dusk', 'night', 'random'], weather: ['clear', 'rain', 'snow', 'mud', 'wind', 'random'], stadium: ['arena', 'classic', 'neon', 'random'] };

// The start-screen choices as saved in the settings, with anything unknown replaced by the default
export function cleanMenuChoices(saved = {}) {
  const out = { mode: '1p', comp: 'friendly', diff: 'normal', teamA: 0, teamB: 1, time: 'day', weather: 'clear', stadium: 'arena' };
  for (const [k, list] of Object.entries(CHOICES)) if (list.includes(saved[k])) out[k] = saved[k];
  for (const k of ['teamA', 'teamB']) if (Number.isInteger(saved[k]) && saved[k] >= 0 && saved[k] < TEAMS.length) out[k] = saved[k];
  return out;
}

// Menu, team selection and the cup / league flow around the game.
export class Menu {
  constructor(game, hud, sfx) {
    this.game = game; this.hud = hud; this.sfx = sfx;
    this.sel = cleanMenuChoices(settings.menu);
    this.tour = null;
    this.career = null; // the running career (the tournament of the career is this.tour)
    this.buildTeams('teamsA', 'teamA');
    this.buildTeams('teamsB', 'teamB');
    this.bindRows();
    $('startBtn').addEventListener('click', () => this.start());
    $('rematchBtn').addEventListener('click', () => this.start());
    $('menuBtn').addEventListener('click', () => this.toMenu());
    $('tourQuit').addEventListener('click', () => { this.tour = null; this.toMenu(); });
    $('careerNew').addEventListener('click', () => this.newCareer());
    buildBallPicker($('ballRow'));
    buildBallSizePicker($('sizeRow'));
    this.buildTactics();
    this.refresh();
    this.previewEnv();
    onSettings(() => this.onSettingsChanged());
  }

  // "Reset all settings" (and anything else that rewrites the saved choices) must show up in the start screen
  onSettingsChanged() {
    this.markTactics();
    const saved = cleanMenuChoices(settings.menu);
    if (JSON.stringify(saved) !== JSON.stringify(this.sel)) { this.sel = saved; this.refresh(); this.previewEnv(); }
  }

  get visible() { return !$('menu').classList.contains('hidden'); }
  get endVisible() { return !$('end').classList.contains('hidden'); }
  get tourVisible() { return !$('tour').classList.contains('hidden'); }

  // Enter key: activate the primary action of whichever screen is open
  primary() {
    if (this.visible) this.start();
    else if (this.tourVisible) $('tourPlay').click();
    else if (this.endVisible) (this.tour ? $('continueBtn') : $('rematchBtn')).click();
  }

  // Offside, match length, pressing and formation live in the saved settings
  buildTactics() {
    const size = S.teamSize || 5;
    $('teamSizeRow').innerHTML = TEAM_SIZES.map((n) => `<button data-n="${n}" title="${n} against ${n}: ${n - 1} outfield players and a goalkeeper">${n}-a-side</button>`).join('');
    $('formRow').innerHTML = formationsFor(size).map((f) => `<button data-f="${f.key}" title="${f.desc}">${f.label}</button>`).join('');
    $('pressRow').innerHTML = PRESS_KEYS.map((k) => `<button data-p="${k}" title="${PRESS[k].desc}">${PRESS[k].label}</button>`).join('');
    if (this._tacBound) return;
    this._tacBound = true;
    const bind = (id, fn) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { fn(b); saveSettings(); this.markTactics(); } });
    bind('formRow', (b) => { S.tactics.formation = b.dataset.f; });
    bind('pressRow', (b) => { S.tactics.press = b.dataset.p; });
    bind('offsideRow', (b) => { S.offside = b.dataset.off === '1'; });
    bind('lengthRow', (b) => { S.length = Number(b.dataset.len); });
    // changing the team size changes the pitch: the background match is restarted so the new pitch is visible at once
    bind('teamSizeRow', (b) => {
      const n = Number(b.dataset.n);
      if (n === S.teamSize) return;
      S.teamSize = n;
      S.tactics.formation = resolveFormation(S.tactics.formation, n);
      this.buildTactics();
      const { teamA, teamB } = this.sel;
      this.game.startAttract([teamA, teamB === teamA ? (teamB + 1) % TEAMS.length : teamB]);
    });
    this.markTactics();
  }

  markTactics() {
    const mark = (id, attr, val) => $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset[attr] === String(val)));
    mark('formRow', 'f', resolveFormation(S.tactics.formation, S.teamSize || 5));
    mark('teamSizeRow', 'n', S.teamSize || 5);
    mark('pressRow', 'p', S.tactics.press);
    mark('offsideRow', 'off', S.offside ? 1 : 0);
    mark('lengthRow', 'len', S.length);
  }

  buildTeams(id, key) {
    const el = $(id);
    el.innerHTML = '';
    TEAMS.forEach((t, i) => {
      const b = document.createElement('button');
      b.dataset.team = i;
      b.title = `${t.name} — ${stars(t.rating)} — ${styleByKey(t.style).label}: ${styleByKey(t.style).desc}`;
      b.style.setProperty('--c', hex(t.home));
      b.innerHTML = `<i></i>${t.code}<em>${stars(t.rating)}</em>`;
      b.addEventListener('click', () => { this.sel[key] = i; this.refresh(); });
      el.appendChild(b);
    });
  }

  bindRows() {
    const row = (id, attr, key, after) => {
      $(id).addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || b.disabled) return;
        this.sel[key] = b.dataset[attr];
        this.refresh();
        after?.();
      });
    };
    row('modeRow', 'mode', 'mode', () => { if (this.sel.mode === 'online' && !this.netUI?.connected) this.netUI?.show(); });
    row('compRow', 'comp', 'comp');
    row('diffRow', 'diff', 'diff');
    row('timeRow', 'time', 'time', () => this.previewEnv());
    row('weatherRow', 'weather', 'weather', () => this.previewEnv());
    row('stadiumRow', 'stadium', 'stadium', () => this.previewEnv());
  }

  previewEnv() {
    const { time, weather, stadium } = this.sel;
    this.game.applyEnv({ time: time === 'random' ? this.game.env.time : time, weather: weather === 'random' ? this.game.env.weather : weather, stadium: stadium === 'random' ? this.game.world.look : stadium, windAngle: this.game.env.windAngle });
  }

  refresh() {
    const s = this.sel;
    if (s.mode !== '1p') s.comp = 'friendly';
    const mark = (id, attr, val) => $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset[attr] === val));
    mark('modeRow', 'mode', s.mode);
    mark('compRow', 'comp', s.comp);
    mark('diffRow', 'diff', s.diff);
    mark('timeRow', 'time', s.time);
    mark('weatherRow', 'weather', s.weather);
    mark('stadiumRow', 'stadium', s.stadium);
    $('compRow').querySelectorAll('button').forEach((b) => { b.disabled = s.mode !== '1p' && b.dataset.comp !== 'friendly'; b.style.opacity = b.disabled ? 0.35 : 1; });
    $('oppBlock').style.display = s.comp === 'friendly' ? '' : 'none';
    this.refreshCareerBlock();
    const online = s.mode === 'online', net = this.netUI;
    $('labelA').textContent = s.mode === '1p' || online ? 'Your team' : s.mode === '2p' ? 'Player 1 team' : 'Home team';
    $('labelB').textContent = s.mode === '1p' ? 'Opponent' : online ? "Friend's team" : s.mode === '2p' ? 'Player 2 team' : 'Away team';
    $('netRow').classList.toggle('hidden', !online);
    if (online) $('netState').textContent = net?.isHost ? '✅ Your friend is connected' : net?.isGuest ? '✅ Connected to the host' : 'Not connected yet';
    $('startBtn').disabled = online && !!net?.isGuest;
    $('teamsA').querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.team) === s.teamA));
    $('teamsB').querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.team) === s.teamB));
    $('startBtn').firstChild.textContent = online ? (net?.isHost ? 'Kick off online ' : net?.isGuest ? 'Waiting for the host ' : 'Connect to a friend ') : s.comp === 'friendly' ? 'Kick off ' : s.comp === 'cup' ? 'Start cup ' : s.comp === 'league' ? 'Start league ' : Career.load() ? 'Continue career ' : 'Start career ';
    document.body.classList.toggle('two', s.mode === '2p');
    if (JSON.stringify(settings.menu) !== JSON.stringify(s)) { settings.menu = { ...s }; saveSettings(); }
  }

  resolveEnv() {
    const { time, weather, stadium } = this.sel;
    return {
      time: time === 'random' ? pickRandom(['day', 'dusk', 'night']) : time,
      weather: weather === 'random' ? pickRandom(['clear', 'clear', 'rain', 'snow', 'mud', 'wind']) : weather,
      stadium: stadium === 'random' ? pickRandom(['arena', 'classic', 'neon']) : stadium,
      windAngle: Math.round(Math.random() * 8) * (Math.PI / 4), // eight compass directions
    };
  }

  start() {
    this.sfx.init();
    const s = this.sel;
    if (s.mode === 'online') return this.startOnline();
    if (s.comp === 'career') return this.startCareer();
    if (s.comp !== 'friendly') {
      this.career = null;
      this.tour = new Tournament(s.comp, s.teamA, s.diff);
      this.showFixture();
      return;
    }
    this.tour = null; this.career = null;
    let b = s.teamB;
    if (b === s.teamA) b = (b + 1) % TEAMS.length;
    this.hud.showMenu(false);
    this.game.startMatch({
      mode: s.mode, teams: [s.teamA, b], diff: s.diff, length: settings.length, size: settings.teamSize, offside: settings.offside, tactics: settings.tactics, knockout: false, env: this.resolveEnv(),
      onEnd: (r) => this.onFriendlyEnd(r),
    });
  }

  // ---------- career ----------
  // The summary line of a saved career under the competition buttons, with the button that erases it
  refreshCareerBlock() {
    const on = this.sel.comp === 'career', saved = on ? Career.load() : null;
    $('careerBlock').classList.toggle('hidden', !on);
    this.eraseArmed = false;
    $('careerNew').textContent = saved ? '🗑 Start a new career (erases this one)' : '';
    $('careerNew').classList.toggle('hidden', !saved);
    $('careerInfo').innerHTML = saved
      ? `Saved career: ${tn(saved.user)} · season ${saved.season} · ${saved.tour.roundName} · ${saved.tour.diffKey}`
      : 'A career is a league season (home and away) with your squad: cards, injuries and form carry over from match to match, and the golden boot race runs through the league.';
  }

  startCareer() {
    this.career = Career.load();
    if (!this.career) this.career = new Career(this.sel.teamA, this.sel.diff);
    this.career.save();
    this.tour = this.career.tour;
    this.showFixture();
  }

  // Two clicks erase the saved career and begin a fresh one with the selected team
  newCareer() {
    if (!this.eraseArmed) { this.eraseArmed = true; $('careerNew').textContent = 'Click again to erase the saved career and start over'; return; }
    Career.clear();
    this.startCareer();
  }

  // Online: the host starts the match for both players; a guest waits for it
  startOnline() {
    const n = this.netUI, s = this.sel;
    if (!n?.isHost) { if (n?.isGuest) this.hud.toast('Waiting for the host to start…', 1500); else n?.show(); return; }
    this.tour = null;
    const b = s.teamB === s.teamA ? (s.teamB + 1) % TEAMS.length : s.teamB;
    this.hud.showMenu(false);
    n.session.start({
      teams: [s.teamA, b], diff: 'normal', length: settings.length, size: settings.teamSize, offside: settings.offside, env: this.resolveEnv(),
      tacticsBy: [settings.tactics, n.session.guestTactics || settings.tactics], knockout: false, onEnd: () => this.onFriendlyEnd(),
    });
  }

  onFriendlyEnd() {
    $('rematchBtn').classList.remove('hidden');
    $('continueBtn').classList.add('hidden');
  }

  toMenu() {
    this.tour = null; this.career = null;
    this.hud.showEnd(false);
    this.hud.show(false);
    $('tour').classList.add('hidden');
    this.hud.showMenu(true);
    this.game.startAttract([this.sel.teamA, this.sel.teamB === this.sel.teamA ? (this.sel.teamB + 1) % TEAMS.length : this.sel.teamB]);
    this.refresh();
  }

  // ---------- tournaments ----------
  chipOf(t) { return `<i style="background:${hex(TEAMS[t].home)}"></i>`; }

  fixtureHtml(f, userTeam) {
    const me = f.a === userTeam || f.b === userTeam;
    const r = f.result;
    const score = r ? `${r.ga} - ${r.gb}${r.pw !== null && r.pw !== undefined ? `<br><small>pens ${r.pw === 0 ? 'A' : 'B'}</small>` : ''}` : 'vs';
    return `<div class="fx ${me ? 'me' : ''}"><span class="t r">${tn(f.a)} ${this.chipOf(f.a)}</span><span class="sc">${score}</span><span class="t">${this.chipOf(f.b)} ${tn(f.b)}</span></div>`;
  }

  standingsHtml(t) {
    const rows = t.standings().map((r, i) => `<tr class="${r.team === t.user ? 'me' : ''}"><td>${i + 1}</td><td>${this.chipOf(r.team)} ${tn(r.team)}</td><td>${r.w + r.d + r.l}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td><b>${r.p}</b></td></tr>`).join('');
    return `<table><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr>${rows}</table>`;
  }

  showTourScreen(title, sub, body, playLabel, playFn) {
    this.hud.showMenu(false); this.hud.showEnd(false); this.hud.show(false);
    $('tour').classList.remove('hidden');
    $('tourTitle').textContent = title;
    $('tourSub').innerHTML = tint(sub);
    $('tourBody').innerHTML = body;
    const btn = $('tourPlay');
    btn.textContent = playLabel;
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
    fresh.addEventListener('click', playFn);
  }

  // Suspended players for the next match and the card table of the user's team
  disciplineHtml(t) {
    const rows = t.discipline.rows();
    if (!rows.length) return '';
    const sq = squad(t.user);
    const line = (r) => `<tr class="${r.banned || r.injured ? 'ban' : ''}"><td>#${sq[r.slot].num} ${sq[r.slot].name}</td><td>${r.yellows ? `<i class="mc y"></i> ${r.yellows}` : ''}</td><td>${r.reds ? `<i class="mc r"></i> ${r.reds}` : ''}</td><td>${r.banned ? 'Suspended' : r.injured ? '🩹 Injured' : ''}</td></tr>`;
    return `<h3 style="text-align:center">Discipline</h3><table class="disc"><tr><th>Player</th><th>Yellow</th><th>Red</th><th></th></tr>${rows.map(line).join('')}</table>`
      + (t.discipline.unavailable().length ? '<div class="hint" style="text-align:center">Suspended and injured players miss the next match.</div>' : '');
  }

  showFixture() {
    const t = this.tour, kind = t.kind === 'cup' ? 'Cup' : 'League';
    if (this.career) return this.showCareerHub();
    const uf = t.userFixture;
    let body = `<div style="text-align:center;margin:6px 0 12px">Your team: <b>${tn(t.user)}</b> ${stars(TEAMS[t.user].rating)}</div>`;
    body += this.disciplineHtml(t);
    body += t.fixtures.map((f) => this.fixtureHtml(f, t.user)).join('');
    if (t.kind === 'league') body += '<h3 style="text-align:center">Table</h3>' + this.standingsHtml(t);
    this.showTourScreen(`${kind} · ${t.roundName}`, `Next: ${TEAMS[t.user].name} vs ${TEAMS[uf.opponent].name}`, body, 'Play match', () => this.playTourMatch(uf.opponent));
  }

  // The career hub between the matches: fixtures, form guide, table, top scorers, squad and past seasons
  showCareerHub() {
    const c = this.career, t = c.tour, uf = t.userFixture;
    const sec = (title, html, open = false) => `<details class="csec"${open ? ' open' : ''}><summary>${title}</summary>${html}</details>`;
    let body = `<div style="text-align:center;margin:6px 0 4px">Your team: <b>${tn(t.user)}</b> ${stars(TEAMS[t.user].rating)} · ${t.diffKey}</div>`;
    body += `<h3 style="text-align:center">Form guide</h3>${formGuideHtml(c)}`;
    body += this.disciplineHtml(t);
    body += t.fixtures.map((f) => this.fixtureHtml(f, t.user)).join('');
    body += sec('Table', this.standingsHtml(t), true);
    body += sec('Top scorers', scorersHtml(c), true);
    body += sec('My squad', squadHtml(c));
    const past = seasonsHtml(c);
    if (past) body += sec('Seasons', past);
    this.showTourScreen(`Career · Season ${c.season} · ${t.roundName}`, `Next: ${TEAMS[t.user].name} vs ${TEAMS[uf.opponent].name}`, body, 'Play match', () => this.playTourMatch(uf.opponent));
  }

  playTourMatch(opp) {
    const t = this.tour;
    $('tour').classList.add('hidden');
    this.game.startMatch({
      mode: '1p', teams: [t.user, opp], diff: t.diffKey, length: 120, knockout: t.knockout, suspended: t.discipline.unavailable(), size: settings.teamSize, offside: settings.offside, tactics: settings.tactics, env: this.resolveEnv(),
      form: this.career?.formMul(),
      onEnd: (r) => this.onTourMatchEnd(r),
    });
  }

  onTourMatchEnd(result) {
    $('rematchBtn').classList.add('hidden');
    $('continueBtn').classList.remove('hidden');
    const btn = $('continueBtn');
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
    fresh.addEventListener('click', () => this.afterMatch(result));
  }

  // The last matchday is played: summary, awards, and the way into the next season
  endCareerSeason(resultsHtml) {
    const c = this.career, entry = c.endSeason(), pos = entry.pos;
    c.save();
    const body = seasonSummaryHtml(entry) + resultsHtml + '<h3 style="text-align:center">Top scorers</h3>' + scorersHtml(c, 5) + '<h3 style="text-align:center">Seasons</h3>' + seasonsHtml(c);
    this.showTourScreen(pos === 1 ? `🏆 SEASON ${entry.season} CHAMPIONS!` : `Season ${entry.season} finished #${pos}`, pos === 1 ? `${TEAMS[c.user].name} win the league` : `${TEAMS[entry.champion].name} are champions`, body, `Start season ${c.season + 1}`, () => {
      const note = c.nextSeason();
      c.save();
      this.tour = c.tour;
      if (note) this.hud.toast(note, 3500);
      this.showFixture();
    });
  }

  afterMatch(result) {
    const t = this.tour;
    t.discipline.record(result.discipline);
    const opp = t.userFixture?.opponent;
    if (this.career) this.career.recordMatch(result, opp);
    t.report({ score: result.score, winner: result.winner });
    if (this.career) { this.career.recordRound(); this.career.save(); }
    const last = t.history[t.history.length - 1];
    const kind = this.career ? `Career · Season ${this.career.season}` : t.kind === 'cup' ? 'Cup' : 'League';
    let body = last.fixtures.map((f) => this.fixtureHtml(f, t.user)).join('');
    if (t.kind === 'league') body += '<h3 style="text-align:center">Table</h3>' + this.standingsHtml(t);
    if (!t.over) {
      this.showTourScreen(`${kind} · ${last.round} results`, 'Round complete', body, this.career ? 'Career hub' : 'Next round', () => this.showFixture());
      return;
    }
    if (this.career) return this.endCareerSeason(body);
    let title, sub;
    if (t.kind === 'cup') {
      if (t.champion === t.user) { title = '🏆 CUP WINNERS!'; sub = `${TEAMS[t.user].name} win the cup`; body = `<div class="trophy">🏆</div>` + body; }
      else { title = 'Knocked out'; sub = `${TEAMS[t.user].name} are out in the ${last.round.toLowerCase()}`; }
    } else {
      const pos = t.standings().findIndex((r) => r.team === t.user) + 1;
      title = pos === 1 ? '🏆 LEAGUE CHAMPIONS!' : `Finished #${pos}`;
      sub = pos === 1 ? `${TEAMS[t.user].name} top the table` : `${TEAMS[t.champion].name} are champions`;
    }
    this.showTourScreen(title, sub, body, 'Back to menu', () => this.toMenu());
  }
}
