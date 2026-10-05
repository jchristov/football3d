import { TEAMS } from './teams.js';
import { tn } from './teamcolor.js';

// The HTML of the career screens (the hub between matches and the end-of-season summary)
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const chip = (t) => `<i style="background:${hex(TEAMS[t].home)}"></i>`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const FORM_ICON = { hot: '<span class="cform hot" title="In form: plays a little better">🔥</span>', cold: '<span class="cform cold" title="Out of form: plays a little worse">❄️</span>' };
const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

export function formGuideHtml(career) {
  const f = career.userForm();
  if (!f.length) return '<div class="hint" style="text-align:center">No matches played yet.</div>';
  return `<div class="cformrow">${f.map((r) => `<b class="fg ${r}">${r}</b>`).join('')}</div>`;
}

export function scorersHtml(career, n = 8) {
  const rows = career.topScorers(n);
  if (!rows.length) return '<div class="hint" style="text-align:center">Nobody has scored yet.</div>';
  return `<table class="ctab"><tr><th>#</th><th>Player</th><th>Team</th><th>Goals</th></tr>${rows.map((r, i) => `<tr class="${r.mine ? 'me' : ''}"><td>${i + 1}</td><td>#${r.num} ${esc(r.name)}</td><td>${chip(r.team)} ${tn(r.team)}</td><td><b>${r.goals}</b></td></tr>`).join('')}</table>`;
}

export function squadHtml(career) {
  const rows = career.squadRows().map((r) => `<tr><td>#${r.num} ${esc(r.name)} ${FORM_ICON[r.form] || ''}</td><td>${r.role}</td><td>${r.apps}</td><td>${r.goals}</td><td>${r.assists}</td><td>${r.rating !== null ? r.rating.toFixed(1) : '–'}</td>`
    + `<td>${r.yellows ? `<i class="mc y"></i>${r.yellows}` : ''}${r.reds ? ` <i class="mc r"></i>${r.reds}` : ''}</td><td class="dim">${r.careerGoals}/${r.careerApps}</td></tr>`).join('');
  return `<table class="ctab sq"><tr><th>Player</th><th>Pos</th><th>Apps</th><th>G</th><th>A</th><th>Avg</th><th>Cards</th><th title="Career goals / appearances">Career</th></tr>${rows}</table>`
    + '<div class="hint" style="text-align:center">🔥 in form (+) · ❄️ out of form (−): based on the last three match ratings.</div>';
}

export function seasonsHtml(career) {
  if (!career.seasons.length) return '';
  const rows = career.seasons.map((s) => `<tr class="${s.pos === 1 ? 'me' : ''}"><td>${s.season}</td><td>${ORD(s.pos)}${s.pos === 1 ? ' 🏆' : ''}</td><td>${s.pts}</td><td>${s.gd > 0 ? '+' : ''}${s.gd}</td><td>${s.gold ? `${esc(s.gold.name)} (${s.gold.goals})` : '–'}</td></tr>`).join('');
  return `<table class="ctab"><tr><th>Season</th><th>Place</th><th>Pts</th><th>GD</th><th>Golden boot</th></tr>${rows}</table>`;
}

// What the summary of a finished season shows
export function seasonSummaryHtml(entry) {
  const bits = [
    `<div class="award">🥇 <b>${tn(entry.champion)}</b> are the champions of season ${entry.season}</div>`,
    entry.gold ? `<div class="award">👟 Golden boot: <b>${esc(entry.gold.name)}</b> (${tn(entry.gold.team)}) with ${entry.gold.goals} goals</div>` : '',
    entry.pots ? `<div class="award">⭐ Your player of the season: <b>${esc(entry.pots.name)}</b> (average ${entry.pots.rating.toFixed(1)})</div>` : '',
  ];
  return `<div class="awards">${bits.join('')}</div>`;
}
