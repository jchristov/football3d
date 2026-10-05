import { TEAMS } from './teams.js';
import { formationsFor, resolveFormation, PRESS } from './tactics.js';
import { MATCH } from './constants.js';
import { specBar } from './tacticsui.js';
import { outOfPosition } from './skills.js';
import { tn } from './teamcolor.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const ROLE = { GK: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'ATT' };

// The team sheet shown before kick-off: both line-ups with formation, pressing and the speciality bars.
// The match waits (game.hold) until the player kicks off; the formation can still be changed from here.
export class LineupUI {
  constructor(game, tacticsUI) {
    this.game = game; this.tacticsUI = tacticsUI;
    this.root = $('lineup');
    this.onStart = null;
    // Capture phase: Enter / Space kick off while the sheet is open, and nothing else sees the key
    window.addEventListener('keydown', (e) => {
      if (!this.open || this.tacticsUI.open) return;
      if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); this.start(); }
    }, true);
  }

  get open() { return !this.root.classList.contains('hidden'); }

  show(onStart) {
    this.onStart = onStart || null;
    this.render();
    this.root.classList.remove('hidden');
    document.body.classList.add('lu-open');
  }

  start() {
    if (!this.open) return;
    this.root.classList.add('hidden');
    document.body.classList.remove('lu-open');
    const cb = this.onStart; this.onStart = null;
    cb?.();
  }

  team(t) {
    const g = this.game, L = g.lineups, idx = g.teamIdx[t], T = TEAMS[idx];
    const tac = L.tactics[t];
    const form = formationsFor(MATCH.size).find((f) => f.key === resolveFormation(tac.formation, MATCH.size));
    const shirt = hex(g.kits.outfield[t].shirt);
    const who = g.mode === '2p' ? `Player ${t + 1}` : g.mode === '1p' ? (t === 0 ? 'You' : 'CPU') : t === 0 ? 'Home' : 'Away';
    const rows = g.teams[t].map((p) => {
      const m = L.member(t, p.index);
      const oop = outOfPosition(p) ? '<i class="oop" title="Playing out of position (-6% skills)">⚠</i>' : '';
      return `<div class="lu-row ${p.isGK ? 'gk' : ''}"><i style="background:${shirt}"></i><b>#${m.num}</b><span>${m.name}${oop}</span><u>${ROLE[p.role] || p.role}</u>${specBar(m.spec)}</div>`;
    }).join('');
    const bench = L.bench[t].map((slot) => { const m = L.rosters[t][slot]; return `<span>#${m.num} ${m.name}</span>`; }).join('');
    const banned = [...L.unavailable[t]].map((slot) => { const m = L.rosters[t][slot]; return m ? `#${m.num} ${m.name}` : ''; }).filter(Boolean);
    return `<div class="lu-team">
      <h3><i style="background:${shirt}"></i>${tn(idx)} <small>${who} · ${stars(T.rating)}</small></h3>
      <div class="lu-meta"><b>${form ? form.label : tac.formation}</b> · ${PRESS[tac.press]?.label || ''}${g.styles?.[t] && g.styles[t].key !== 'balanced' ? ` · <span title="${g.styles[t].desc}">${g.styles[t].label}</span>` : ''}</div>
      <div class="lu-list">${rows}</div>
      <div class="lu-bench"><em>Bench</em>${bench || '<span>–</span>'}</div>
      ${banned.length ? `<div class="lu-banned">Suspended: ${banned.join(', ')}</div>` : ''}
    </div>`;
  }

  render() {
    const g = this.game;
    this.root.innerHTML = `<div class="panel wide lu">
      <h2>Team sheets</h2>
      <p class="tag">${g.cfg?.knockout ? 'Knockout match · ' : ''}${MATCH.size}-a-side</p>
      <div class="lu-cols">${this.team(0)}${this.team(1)}</div>
      <div class="lu-legend">Bars: <span class="lg d"></span>defending <span class="lg m"></span>midfield <span class="lg a"></span>attacking · ⚠ out of position</div>
      <div class="row">
        <button id="luTactics">📋 Tactics &amp; subs <small>(U)</small></button>
        <button id="luStart" class="primary">Kick off <small>(Enter)</small></button>
      </div>
    </div>`;
    $('luStart').onclick = () => this.start();
    $('luTactics').onclick = () => this.tacticsUI.show({ onClose: () => this.render() });
  }
}
