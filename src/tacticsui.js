import { TEAMS } from './teams.js';
import { formationsFor, resolveFormation, PRESS, PRESS_KEYS, homeSlots } from './tactics.js';
import { MATCH, PITCH } from './constants.js';
import { MAX_SUBS } from './lineups.js';
import { tn } from './teamcolor.js';
import { outOfPosition } from './skills.js';
import { settings, saveSettings } from './settings.js';

const $ = (id) => document.getElementById(id);
// Overall energy (amber) and the speciality (defending / midfield / attacking) as small bars for the team view
const energyBar = (e) => `<em class="mb en ${e < 0.3 ? 'low' : ''}" title="Energy ${Math.round(e * 100)}%"><u style="width:${Math.round(e * 100)}%"></u></em>`;
export const specBar = (s) => {
  if (!s) return '';
  const NAME = { DEF: 'Defender', MID: 'Midfielder', FWD: 'Attacker', GK: 'Keeper' };
  return `<em class="mb sp" title="${NAME[s.main]} — defending ${s.def}% · midfield ${s.mid}% · attacking ${s.att}%"><i class="d" style="width:${s.def}%"></i><i class="m" style="width:${s.mid}%"></i><i class="a" style="width:${s.att}%"></i></em>`;
};
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

function diagram(key, size = 64) {
  const c = document.createElement('canvas');
  c.width = size * 1.5; c.height = size; c.className = 'fdiag';
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(46,170,92,.35)'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.2; g.strokeRect(1, 1, c.width - 2, c.height - 2);
  g.beginPath(); g.moveTo(c.width / 2, 1); g.lineTo(c.width / 2, c.height - 1); g.stroke();
  g.fillStyle = '#fff';
  homeSlots(key).forEach((s) => {
    const x = 6 + (s.lx / (2 * PITCH.hl)) * (c.width - 12), y = c.height / 2 + (s.lz / PITCH.hw) * (c.height / 2 - 6);
    g.beginPath(); g.arc(x, y, s.role === 'GK' ? 2.6 : MATCH.size > 7 ? 3.2 : 4.2, 0, Math.PI * 2); g.fillStyle = s.role === 'GK' ? '#ffd21e' : '#fff'; g.fill();
  });
  return c;
}

// Tactics & substitutions: formation, pressing style, lineup and bench for each human-controlled team.
// Opened from the pause screen, and automatically at half time.
export class TacticsUI {
  constructor(game, hud) {
    this.game = game; this.hud = hud;
    this.root = $('tactics');
    this.halftime = false;
    this.sel = [-1, -1]; // selected on-pitch player per team
    window.addEventListener('keydown', (e) => {
      if (this.open && e.code === 'Escape' && !this.halftime) { e.preventDefault(); e.stopImmediatePropagation(); this.close(); }
    }, true);
  }

  get open() { return !this.root.classList.contains('hidden'); }

  show({ halftime = false, onClose = null } = {}) {
    this.onClose = onClose;
    this.halftime = halftime;
    this.sel = [-1, -1];
    this.render();
    this.root.classList.remove('hidden');
  }

  close() {
    this.root.classList.add('hidden');
    const cb = this.onClose; this.onClose = null;
    if (this.halftime) { this.halftime = false; this.game.endHalftime(); }
    cb?.();
  }

  teamsToShow() {
    const g = this.game;
    const list = g.ctrls.map((c) => c.team);
    return list.length ? list : g.mode === 'cpu' ? [0, 1] : [0]; // a watched CPU match lets you manage both sides
  }

  render() {
    const g = this.game;
    const teams = this.teamsToShow();
    const who = (t) => (g.mode === '2p' ? `Player ${t + 1}` : g.mode === 'cpu' ? (t ? 'Away' : 'Home') : 'Your team');
    this.root.innerHTML = `<div class="panel wide tac">
      <h2>${this.halftime ? `HALF TIME <small>${g.score[0]} – ${g.score[1]}</small>` : 'Tactics &amp; substitutions'}</h2>
      ${this.halftime ? '<div class="stats" id="tacStats"></div>' : ''}
      <div class="tac-cols cols${teams.length}">${teams.map((t) => this.teamPanel(t, who(t))).join('')}</div>
      <div class="row"><button id="tacDone" class="primary">${this.halftime ? 'Start second half' : 'Done'}</button></div>
    </div>`;
    if (this.halftime) this.hud.renderStats('tacStats', g);
    this.bind(teams);
  }

  teamPanel(t, label) {
    const g = this.game, L = g.lineups, tac = g.tactics[t], team = TEAMS[g.teamIdx[t]];
    const shirt = hex(g.kits.outfield[t].shirt);
    const cur = resolveFormation(tac.formation, MATCH.size);
    const forms = formationsFor(MATCH.size).map((f) => `<button class="fopt ${cur === f.key ? 'on' : ''}" data-t="${t}" data-f="${f.key}" title="${f.desc}"><span class="slot" data-d="${f.key}"></span><span>${f.short}</span></button>`).join('');
    const press = PRESS_KEYS.map((k) => `<button class="${tac.press === k ? 'on' : ''}" data-t="${t}" data-p="${k}" title="${PRESS[k].desc}">${PRESS[k].label}</button>`).join('');
    const cards = (m) => (L.injured[t].has(m.slot) ? '<i class="cd inj" title="Injured">🩹</i>' : '') + (L.sentOff[t].has(m.slot) ? '<i class="cd r" title="Sent off"></i>' : L.yellowsOf(t, m.slot) ? '<i class="cd y" title="Yellow card"></i>' : '');
    const row = (member, e, cls, attrs) => `<button class="pl ${cls}" ${attrs}><i style="background:${shirt}"></i><b>#${member.num}</b><span>${member.name}${cards(member)}</span><span class="pbars">${energyBar(e)}${specBar(member.spec)}</span></button>`;
    const pitch = L.onPitch[t].map((slot, i) => {
      let m = L.rosters[t][slot]; const p = g.pool[t][i], off = L.dead[t].has(i);
      if (!off && outOfPosition(p)) m = { ...m, name: `${m.name} <i class="oop" title="Playing out of position (-6% skills)">⚠</i>` };
      return row(m, p.energy, `${i === 0 ? 'gk' : ''} ${off ? 'off' : ''} ${this.sel[t] === i ? 'sel' : ''}`, `data-t="${t}" data-pi="${i}" ${i === 0 || off ? 'disabled' : ''}`);
    }).join('');
    const bench = L.bench[t].map((slot, k) => row(L.rosters[t][slot], L.energy[t].get(slot) ?? 1, 'bench', `data-t="${t}" data-bk="${k}" ${L.canSub(t) && !L.injured[t].has(slot) ? '' : 'disabled'}`)).join('');
    const down = L.dead[t].size;
    const subsLeft = MAX_SUBS - L.subs[t];
    return `<div class="tac-team">
      <h3><i style="background:${shirt}"></i>${tn(this.game.teamIdx[t])} <small>${label}</small></h3>
      <div class="tlabel">Formation</div><div class="fopts">${forms}</div>
      <div class="tlabel">Pressing</div><div class="row left">${press}</div>
      <div class="tlabel">On the pitch <small>(select a player, then a substitute)${down ? ` · ${down} sent off, playing with ${L.playersOn(t)}` : ''}</small></div><div class="plist">${pitch}</div>
      <div class="tlabel legend">Bars: <span class="lg en"></span>energy · <span class="lg d"></span>defending <span class="lg m"></span>midfield <span class="lg a"></span>attacking</div>
      <div class="tlabel">Bench <small>${subsLeft} substitution${subsLeft === 1 ? '' : 's'} left</small></div><div class="plist">${bench}</div>
    </div>`;
  }

  bind(teams) {
    const r = this.root, g = this.game;
    r.querySelectorAll('.slot').forEach((s) => s.replaceWith(diagram(s.dataset.d)));
    r.querySelector('#tacDone').onclick = () => this.close();
    r.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => this.setTactic(Number(b.dataset.t), { formation: b.dataset.f }); });
    r.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => this.setTactic(Number(b.dataset.t), { press: b.dataset.p }); });
    r.querySelectorAll('[data-pi]').forEach((b) => {
      b.onclick = () => { const t = Number(b.dataset.t), i = Number(b.dataset.pi); this.sel[t] = this.sel[t] === i ? -1 : i; this.render(); };
    });
    r.querySelectorAll('[data-bk]').forEach((b) => {
      b.onclick = () => {
        const t = Number(b.dataset.t), k = Number(b.dataset.bk);
        if (this.sel[t] < 1) { this.hud.toast('Select a player on the pitch first', 1200); return; }
        g.substitute(t, this.sel[t], k);
        this.sel[t] = -1;
        this.render();
      };
    });
  }

  // The human's choice becomes the default for the next match as well
  setTactic(team, change) {
    const g = this.game;
    g.setTactics(team, change);
    if (team === 0 && g.ctrls.some((c) => c.team === 0)) { Object.assign(settings.tactics, change); saveSettings(); }
    this.render();
  }
}
