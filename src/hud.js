import * as THREE from 'three';
import { PITCH } from './constants.js';
import { tint } from './teamcolor.js';
import { settings } from './settings.js';
import { outOfPosition } from './skills.js';
import { renderAnalysis } from './analysis.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

const GLOBAL_KEYS = '<b>V</b> replay · <b>N</b> commentary · <b>C</b> camera · <b>P</b>/<b>Esc</b> pause · <b>M</b> mute · <b>B</b> map · <b>H</b> help · <b>O</b> options · <b>U</b> team · <b>I</b> events · <b>G</b> bars';
const HELP = {
  '1p': `<b>WASD</b>/<b>Arrows</b> move · <b>Shift</b> sprint · <b>Space</b> shoot (hold) · <b>R</b>+shoot curler · <b>F</b> pass (hold = lob)<br /><b>E</b> tackle · <b>Q</b>/<b>Tab</b> switch · <b>T</b> autopilot · <b>V</b> replay · <b>N</b> commentary · <b>C</b> camera<br /><b>P</b>/<b>Esc</b> pause · <b>M</b> mute · <b>B</b> map · <b>H</b> help · <b>O</b> options · <b>U</b> team changes`,
  '2p': `<b>P1</b> WASD · Shift · Space shoot · R curl · F pass · E tackle · Q switch<br /><b>P2</b> Arrows · R-Shift · Enter shoot · ' curl · . pass · , tackle · / switch<br />${GLOBAL_KEYS}`,
  cpu: GLOBAL_KEYS,
};

export class Hud {
  constructor() {
    this.root = $('hud');
    this.scoreHome = $('scoreHome');
    this.scoreAway = $('scoreAway');
    this.clock = $('clock');
    this.banner = $('banner');
    this.bars = [$('power'), $('power2')];
    this.barWraps = [$('powerWrap'), $('powerWrap2')];
    this.mini = $('minimap').getContext('2d');
    this.menu = $('menu');
    this.end = $('end');
    this.pause = $('pause');
    this.toastEl = $('toast');
    this.cardEl = $('cardFlash');
    this.varEl = $('varFlash');
    this.evPanel = $('events');
    this.evToggle = $('evToggle');
    this.cardBadges = [$('cardsHome'), $('cardsAway')];
    this._badgeKey = ['', ''];
    this._evKey = '';
    this.cardTimer = 0;
    this.bannerTimer = 0;
    this.toastTimer = 0;
    this.kits = [0x1e6bff, 0xe4002b];
    this.comm = $('commentary');
    this.vitals = [0, 1].map((i) => ({
      el: $(`vitals${i}`), energy: $(`vitals${i}`).querySelector('.energy i'), sprint: $(`vitals${i}`).querySelector('.energy u'),
      spec: $(`vitals${i}`).querySelector('.spec'), segs: [...$(`vitals${i}`).querySelectorAll('.spec i')], specKey: '',
    }));
    this.tagV = new THREE.Vector3();
    // Floating energy / speciality bars under the player who has the ball
    const cb = document.createElement('div');
    cb.id = 'carrierBars';
    cb.innerHTML = '<b></b><div class="vbar energy"><i></i><u></u></div><div class="vbar spec"><i class="d"></i><i class="m"></i><i class="a"></i></div>';
    this.root.appendChild(cb);
    this.carrier = { el: cb, name: cb.querySelector('b'), energy: cb.querySelector('.energy i'), sprint: cb.querySelector('.energy u'), spec: cb.querySelector('.spec'), segs: [...cb.querySelectorAll('.spec i')], specKey: '', player: null, t: 0 };
    this.tags = [0, 1].map((i) => {
      const el = document.createElement('div');
      el.className = `ptag p${i}`;
      this.root.appendChild(el);
      return el;
    });
  }

  showCommentary(text) {
    if (text) this.comm.querySelector('span').innerHTML = tint(text);
    this.comm.classList.toggle('show', !!text);
  }

  // Floating "#9 NAME" over each human-controlled player
  updateTags(game) {
    const cam = game.camera;
    this.tags.forEach((el, i) => {
      const c = game.ctrls[i], p = c && c.enabled ? c.player : null;
      const live = p && !['ended', 'replay', 'paused'].includes(game.state);
      if (!live) { el.style.display = 'none'; return; }
      this.tagV.set(p.pos.x, 3.5, p.pos.z).project(cam);
      if (this.tagV.z > 1) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.textContent = `${i === 1 ? 'P2' : game.mode === '2p' ? 'P1' : ''} #${p.num} ${p.name}${p.yellows ? ' 🟨' : ''}`.trim();
      el.style.left = `${(this.tagV.x * 0.5 + 0.5) * window.innerWidth}px`;
      el.style.top = `${(-this.tagV.y * 0.5 + 0.5) * window.innerHeight}px`;
    });
  }

  renderStats(id, game) {
    const [ca, cb] = game.kits.outfield.map((k) => hex(k.shirt));
    const rows = game.stats.rows(game.rules.fouls, { offside: game.offsideOn }).map(([label, l, r, share]) => `
      <div class="st-row"><span class="v">${l}</span>
        <div class="mid"><em>${label}</em><div class="bar"><i style="width:${Math.round(share * 100)}%;background:${ca}"></i><i style="width:${100 - Math.round(share * 100)}%;background:${cb}"></i></div></div>
        <span class="v r">${r}</span></div>`).join('');
    $(id).innerHTML = `<div class="st-head"><b>${game.teamCode(0)}</b><span>MATCH STATS</span><b>${game.teamCode(1)}</b></div>${rows}`;
  }

  renderScorers(game) {
    const goals = game.stats.goals;
    $('scorers').innerHTML = goals.map((g) => `<div class="${g.team === 0 ? 'l' : 'r'}">⚽ ${g.minute}' ${g.name}${g.own ? ' (OG)' : ''}</div>`).join('');
  }

  setTeams(codes, colors, who) {
    this.kits = colors;
    $('nameHome').textContent = codes[0];
    $('nameAway').textContent = codes[1];
    $('whoHome').textContent = who[0];
    $('whoAway').textContent = who[1];
    $('chipHome').style.background = hex(colors[0]);
    $('chipAway').style.background = hex(colors[1]);
  }

  setMinimap(on) { $('minimap').classList.toggle('hidden', !on); }
  setControlsHelp(mode) { $('help').innerHTML = HELP[mode] || HELP['1p']; }
  setAutopilot(on) { $('autoBadge').classList.toggle('hidden', !on); }
  showReplay(on, label = '▶ REPLAY') {
    $('replay').classList.toggle('hidden', !on);
    $('replayLabel').textContent = label;
  }

  // "Goal of the match" button on the full-time screen
  setBestGoal(goal) {
    const b = $('bestBtn');
    b.classList.toggle('hidden', !goal);
    $('clipBtn').classList.toggle('hidden', !goal);
    if (!goal) return;
    const bits = [goal.curl && 'curler', goal.volley && 'volley', goal.header && 'header', goal.dist >= 14 && `${goal.dist} m`].filter(Boolean);
    $('bestLabel').textContent = `${goal.name} ${goal.minute}'${bits.length ? ` · ${bits.join(', ')}` : ''}`;
  }
  show(on) { this.root.classList.toggle('hidden', !on); $('hudBtns').classList.toggle('hidden', !on); }
  showMenu(on) { this.menu.classList.toggle('hidden', !on); }
  showEnd(on) { this.end.classList.toggle('hidden', !on); }
  showPause(on) { this.pause.classList.toggle('hidden', !on); }

  setBanner(title, sub = '', ms = 0) {
    this.banner.querySelector('h1').textContent = title;
    this.banner.querySelector('p').innerHTML = tint(sub);
    this.banner.classList.add('show');
    this.bannerTimer = ms / 1000;
  }
  // The referee shows a card: kind = 'yellow' | 'red' | 'second' (second yellow, then red)
  showCard(kind, who, team) {
    const el = this.cardEl;
    el.className = `show ${kind}`;
    el.querySelector('b').textContent = { yellow: 'YELLOW CARD', red: 'RED CARD', second: 'SECOND YELLOW · RED CARD' }[kind];
    el.querySelector('span').innerHTML = `${who} · ${tint(team)}`;
    void el.offsetWidth; // restart the animation
    this.cardTimer = kind === 'yellow' ? 2.6 : 3;
  }
  // The VAR monitor: state = 'check' (reviewing) | 'stands' | 'changed'
  showVar(state, text, seconds = 3) {
    const el = this.varEl;
    el.className = `show ${state}`;
    el.querySelector('b').textContent = { check: 'VAR CHECK', stands: 'DECISION STANDS', changed: 'DECISION CHANGED' }[state];
    el.querySelector('span').textContent = text;
    el.style.setProperty('--var-t', `${seconds}s`);
    void el.offsetWidth; // restart the animation
    this.varTimer = seconds + 0.2;
  }
  hideVar() { this.varEl.className = ''; this.varTimer = 0; }
  hideCard() { this.cardEl.className = ''; this.cardTimer = 0; }
  hideBanner() { this.banner.classList.remove('show'); this.bannerTimer = 0; }

  toast(text, ms = 1100) {
    this.toastEl.innerHTML = tint(text);
    this.toastEl.classList.add('show');
    this.toastTimer = ms / 1000;
  }

  // kicks: [[bool...], [bool...]] or null to hide
  setPens(kicks) {
    const el = $('pens');
    el.classList.toggle('hidden', !kicks);
    if (!kicks) return;
    const row = (k) => {
      const n = Math.max(5, k.length);
      let s = '';
      for (let i = 0; i < n; i++) s += `<i class="${i < k.length ? (k[i] ? 'goal' : 'miss') : ''}"></i>`;
      return s;
    };
    el.innerHTML = `<div>${row(kicks[0])}</div><div>${row(kicks[1])}</div>`;
  }

  // Heat maps, shot map and passing networks on the full-time screen
  renderAnalysis(game) { renderAnalysis($('endAnalysis'), game); }

  // Man of the match and the player ratings on the full-time screen
  renderRatings(game) {
    const el = $('endRatings'), list = game.ratings || [], m = game.motm;
    if (!list.length) { el.innerHTML = ''; return; }
    const [ca, cb] = game.kits.outfield.map((k) => hex(k.shirt));
    const col = (t, color) => `<div class="rt-col"><h4 style="color:${color}">${game.teamCode(t)}</h4>${list.filter((r) => r.team === t).map((r) => `<div class="rt-row ${m && m.key === r.key ? 'motm' : ''}"><b>#${r.num}</b><span>${r.name}</span><em class="${r.rating >= 7.5 ? 'hi' : r.rating < 5.5 ? 'lo' : ''}">${r.rating.toFixed(1)}</em></div>`).join('')}</div>`;
    el.innerHTML = (m ? `<div class="motm-box">⭐ <b>MAN OF THE MATCH</b> · #${m.num} ${m.name} · ${tint(game.teamName(m.team))} · <em>${m.rating.toFixed(1)}</em><small>${m.goals ? `${m.goals} goal${m.goals > 1 ? 's' : ''} · ` : ''}${m.assists ? `${m.assists} assist${m.assists > 1 ? 's' : ''} · ` : ''}${m.tackles ? `${m.tackles} tackle${m.tackles > 1 ? 's' : ''} · ` : ''}${m.saves ? `${m.saves} save${m.saves > 1 ? 's' : ''} · ` : ''}${Math.round((m.passes ? m.passesOk / m.passes : 0) * 100)}% passes</small></div>` : '')
      + `<details class="ratings"><summary>Player ratings</summary><div class="rt-cols">${col(0, ca)}${col(1, cb)}</div></details>`;
  }

  setEnd(score, msg) {
    $('finalScore').textContent = `${score[0]} - ${score[1]}`;
    $('finalMsg').innerHTML = tint(msg);
  }

  // Booked (yellow) and sent-off (red) players of each team, as little cards beside the score widget
  updateCardBadges(game) {
    const L = game.lineups;
    for (let t = 0; t < 2; t++) {
      let y = 0, r = 0;
      if (L && !game.attract) {
        r = L.sentOff[t].size;
        for (const [slot, n] of L.yellows[t]) if (n > 0 && !L.sentOff[t].has(slot)) y++;
      }
      const key = `${y}/${r}`;
      if (key === this._badgeKey[t]) continue;
      this._badgeKey[t] = key;
      this.cardBadges[t].innerHTML = (y ? `<span class="cb y">${y}</span>` : '') + (r ? `<span class="cb r">${r}</span>` : '');
      this.cardBadges[t].title = `${y} booked (yellow), ${r} sent off (red)`;
    }
  }

  // The collapsible match log under the score widget: home events on the left, away events on the right
  updateEvents(game) {
    const usable = !game.attract && !game.rules.so && game.state !== 'ended' && game.state !== 'replay';
    const open = settings.events && usable;
    this.evToggle.classList.toggle('hidden', !usable);
    this.evPanel.classList.toggle('hidden', !open);
    this.evPanel.classList.toggle('dim', this.bannerTimer > 0 || this.cardTimer > 0); // keep the GOAL / card announcements readable
    this.evToggle.textContent = `${settings.events ? '▴' : '▾'} Match events${game.events.length ? ` (${game.events.length})` : ''}`;
    if (!open) { this._evKey = ''; return; }
    const key = `${game.eventsVersion}|${game.teamCode(0)}${game.teamCode(1)}`;
    if (key === this._evKey) return;
    this._evKey = key;
    const [ca, cb] = game.kits.outfield.map((k) => hex(k.shirt));
    const card = (c) => `<i class="mc ${c}"></i>`;
    const text = (e) => ({
      goal: `⚽ <b>${e.name}</b>${e.own ? ' <small>(own goal)</small>' : ''}`,
      yellow: `${card('y')} ${e.name}`,
      second: `${card('y')}${card('r')} ${e.name} <small>2nd yellow</small>`,
      red: `${card('r')} ${e.name}`,
      sub: `<span class="in">▲ ${e.inName}</span> <span class="out">▼ ${e.outName}</span>`,
      pen: `🎯 Penalty <small>(fouled by ${e.name})</small>`,
      keeper: `🧤 ${e.name} <small>in goal</small>`,
      injury: `🩹 ${e.name} <small>injured</small>`,
      var: `📺 VAR <small>${e.text}</small>`,
    })[e.type] || '';
    const rows = game.events.map((e) => {
      if (e.type === 'ht' || e.type === 'ft') return `<div class="ev mid">${e.type === 'ht' ? 'HALF TIME' : 'FULL TIME'} · ${e.score[0]} – ${e.score[1]}</div>`;
      const cell = (cls, color) => `<span class="${cls}" style="border-color:${color}">${text(e)}</span>`;
      return `<div class="ev">${e.team === 0 ? cell('l', ca) : '<span></span>'}<em>${e.minute}'</em>${e.team === 1 ? cell('r', cb) : '<span></span>'}</div>`;
    }).join('');
    this.evPanel.innerHTML = `<div class="ev-head"><b style="color:${ca}">${game.teamCode(0)}</b><span>MATCH EVENTS</span><b style="color:${cb}">${game.teamCode(1)}</b></div>`
      + `<div class="ev-list">${rows || '<div class="ev mid">Nothing has happened yet</div>'}</div>`;
    const list = this.evPanel.querySelector('.ev-list');
    list.scrollTop = list.scrollHeight;
  }

  update(game, dt) {
    this.updateCardBadges(game);
    this.updateEvents(game);
    this.updateCarrier(game, dt);
    if (this.cardTimer > 0 && (this.cardTimer -= dt) <= 0) this.hideCard();
    if (this.varTimer > 0 && (this.varTimer -= dt) <= 0) this.hideVar();
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.hideBanner();
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    this.scoreHome.textContent = game.score[0];
    this.scoreAway.textContent = game.score[1];
    // Each half is timed on its own: the clock shows what is left of the current half
    const len = game.cfg?.length || game.clock;
    const left = !game.attract && game.half === 1 ? game.clock - len / 2 : game.clock;
    const t = Math.max(0, Math.ceil(left));
    const inShootout = !!game.rules.so;
    // counting up shows the elapsed match time (continuing into the second half), counting down the time left in the half
    const shown = settings.clockUp ? Math.min(len, Math.max(0, Math.floor(len - game.clock))) : t;
    this.clock.textContent = game.attract ? '--:--' : inShootout ? 'PENS' : `${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, '0')}`;
    this.clock.title = settings.clockUp ? 'Elapsed time (change in Settings)' : 'Time left in this half (change in Settings)';
    this.clock.classList.toggle('low', !game.attract && !inShootout && t <= 15);
    $('halfTag').textContent = game.attract ? '' : inShootout ? 'SHOOT-OUT' : game.state === 'halftime' ? 'HALF TIME' : game.half === 1 ? '1ST HALF' : '2ND HALF';

    for (let i = 0; i < 2; i++) {
      const c = game.ctrls[i], p = c && c.enabled ? c.player : null;
      const ch = p ? p.charge : 0;
      this.barWraps[i].classList.toggle('on', ch > 0.02);
      this.bars[i].style.width = `${Math.round(ch * 100)}%`;
    }
    this.drawMinimap(game);
    this.updateTags(game);
    this.updateVitals(game);
  }

  // Per human-controlled player: overall energy (amber) with the sprint tank as a thin line, and the player's speciality
  // as one segmented bar (defending / midfield / attacking)
  updateVitals(game) {
    const live = !['ended', 'replay'].includes(game.state);
    this.vitals.forEach((v, i) => {
      const c = game.ctrls[i], p = c && c.enabled && live && settings.playerBars ? c.player : null;
      v.el.style.display = p ? 'block' : 'none';
      if (!p) return;
      v.energy.style.width = `${Math.round(p.energy * 100)}%`;
      v.sprint.style.width = `${Math.round(p.stamina * 100)}%`;
      v.energy.parentElement.classList.toggle('low', p.energy < 0.3);
      v.sprint.classList.toggle('low', p.stamina < 0.2);
      this.drawSpeciality(v, p);
    });
  }

  // The bars of whoever has the ball (G toggles them); they linger a moment after a tackle or a pass
  updateCarrier(game, dt) {
    const c = this.carrier, b = game.ball;
    const live = settings.playerBars && !game.attract && !['ended', 'replay', 'paused', 'halftime'].includes(game.state);
    const p = b.held || b.owner;
    if (p && !p.dead) { c.player = p; c.t = 0.45; } else c.t -= dt;
    if (!live || !c.player || c.player.dead || c.t <= 0) { c.el.style.display = 'none'; return; }
    this.tagV.set(c.player.pos.x, 0, c.player.pos.z).project(game.camera);
    if (this.tagV.z > 1) { c.el.style.display = 'none'; return; }
    const q = c.player;
    c.el.style.display = 'block';
    c.el.style.left = `${(this.tagV.x * 0.5 + 0.5) * window.innerWidth}px`;
    c.el.style.top = `${(-this.tagV.y * 0.5 + 0.5) * window.innerHeight + 16}px`;
    c.el.style.borderColor = hex(game.kits.outfield[q.team].shirt);
    const oop = outOfPosition(q);
    c.name.textContent = `#${q.num} ${q.name}${oop ? ' ⚠' : ''}`;
    c.name.title = oop ? 'Playing out of position (-6% skills)' : '';
    c.energy.style.width = `${Math.round(q.energy * 100)}%`;
    c.sprint.style.width = `${Math.round(q.stamina * 100)}%`;
    c.energy.parentElement.classList.toggle('low', q.energy < 0.3);
    this.drawSpeciality(c, q);
  }

  drawSpeciality(v, p) {
    const s = p.spec || { def: 33, mid: 34, att: 33, main: 'MID', gk: false };
    const key = `${s.def}/${s.mid}/${s.att}/${s.main}`;
    if (key === v.specKey) return;
    v.specKey = key;
    const NAME = { DEF: 'DEFENDER', MID: 'MIDFIELDER', FWD: 'ATTACKER', GK: 'KEEPER' };
    const vals = [s.def, s.mid, s.att];
    const mainIdx = { GK: 0, DEF: 0, MID: 1, FWD: 2 }[s.main];
    v.segs.forEach((el, k) => {
      el.style.width = `${vals[k]}%`;
      el.dataset.l = k === mainIdx ? NAME[s.main] : vals[k] >= 8 ? ['D', 'M', 'A'][k] : '';
      el.classList.toggle('main', k === mainIdx);
    });
    v.spec.title = `${NAME[s.main]} — defending ${s.def}% · midfield ${s.mid}% · attacking ${s.att}%`;
  }

  drawMinimap(game) {
    const g = this.mini, W = 200, H = 130, pad = 10;
    const sx = (W - pad * 2) / (PITCH.hl * 2), sz = (H - pad * 2) / (PITCH.hw * 2);
    const X = (x) => pad + (x + PITCH.hl) * sx, Z = (z) => pad + (z + PITCH.hw) * sz;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(30,120,50,.55)';
    g.fillRect(pad, pad, W - pad * 2, H - pad * 2);
    g.strokeStyle = 'rgba(255,255,255,.7)';
    g.lineWidth = 1;
    g.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
    g.beginPath(); g.moveTo(X(0), pad); g.lineTo(X(0), H - pad); g.stroke();
    g.beginPath(); g.arc(X(0), Z(0), 14, 0, Math.PI * 2); g.stroke();
    for (const t of [0, 1]) {
      g.fillStyle = hex(this.kits[t]);
      for (const p of game.teams[t]) {
        g.beginPath(); g.arc(X(p.pos.x), Z(p.pos.z), p.isGK ? 3 : 3.8, 0, Math.PI * 2); g.fill();
        if (game.isHuman(p)) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.lineWidth = 1; }
      }
    }
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(X(game.ball.pos.x), Z(game.ball.pos.z), 2.8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#000'; g.stroke();
  }
}
