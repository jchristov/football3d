import { TEAMS, squad, pickKits } from './teams.js';
import { settings, saveSettings } from './settings.js';
import {
  SKIN_TONES, SKIN_MAX, skinHex, HAIR_COLORS, HAIR_STYLES, STYLE_LABELS, BEARDS, BEARD_LABELS, BOOT_COLORS, EYE_COLORS,
  defaultLook, randomLook, cleanName, SLOTS, SLOT_ROLES,
} from './appearance.js';
import { LookPreview } from './lookpreview.js';
import { benchSize } from './constants.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const css = (n) => hex(n);

// Squads & looks: browse every team's eight players and restyle them (name, skin tone, hair, beard, boots).
// Edits are saved and show up everywhere in the game. One WebGL context renders all previews.
export class SquadUI {
  constructor(game) {
    this.game = game;
    this.root = $('squad');
    this.team = 0;
    this.slot = 1;
    this.pv = null;
    this.yaw = 0.5;
    window.addEventListener('keydown', (e) => {
      if (this.open && e.code === 'Escape' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); }
    }, true);
  }

  get open() { return !this.root.classList.contains('hidden'); }

  show(onClose) {
    this.onClose = onClose || null;
    if (!this.pv) {
      const cv = document.createElement('canvas');
      this.pv = new LookPreview(cv, { width: 260, height: 300, mode: 'bust' });
      this.pvCanvas = cv;
    }
    this.root.classList.remove('hidden');
    this.render();
  }

  close() {
    this.root.classList.add('hidden');
    this.onClose?.();
    this.onClose = null;
  }

  kitFor(team, slot) {
    const k = pickKits(team, (team + 1) % TEAMS.length);
    return slot === 0 ? k.gk[0] : k.outfield[0];
  }

  // Render one squad member into a 2D canvas
  paint(ctx2d, w, h, team, slot, yaw) {
    const m = squad(team)[slot];
    this.pv.show({ kit: this.kitFor(team, slot), num: m.num, name: m.name, look: m.look, captain: m.captain, gk: slot === 0 });
    this.pv.render(yaw);
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.drawImage(this.pvCanvas, 0, 0, this.pvCanvas.width, this.pvCanvas.height, 0, 0, w, h);
  }

  render() {
    const sq = squad(this.team), cur = sq[this.slot], look = cur.look;
    const tabs = TEAMS.map((t, i) => `<button class="tab ${i === this.team ? 'on' : ''}" data-team="${i}"><i style="background:${css(t.home)}"></i>${t.code}</button>`).join('');
    const N = settings.teamSize || 5, B = benchSize(N);
    const where = (i) => (i === 0 ? 'Goalkeeper' : i < N ? 'Starter' : i < N + B ? 'Bench' : 'Reserve');
    const cards = sq.map((m, i) => `<button class="card ${i === this.slot ? 'on' : ''} ${i >= N + B ? 'reserve' : ''}" data-slot="${i}"><canvas width="132" height="150"></canvas><b>#${m.num} ${m.name}</b><em>${where(i)} · ${SLOT_ROLES[i]}${m.captain ? ' · C' : ''}</em></button>`).join('');
    const skinStrip = SKIN_TONES.map((c, i) => `<i style="background:${css(c)}" data-skin="${i}"></i>`).join('');
    const sw = (list, key, cur) => list.map((c) => `<button class="sw ${cur === c.key ? 'on' : ''}" style="--c:${css(c.hex)}" data-${key}="${c.key}" title="${c.label}"></button>`).join('');
    const opt = (list, labels, key, cur) => list.map((k) => `<button class="${cur === k ? 'on' : ''}" data-${key}="${k}">${labels[k]}</button>`).join('');
    this.root.innerHTML = `<div class="panel wide sq">
      <h2>Squads &amp; looks <button id="sqClose" aria-label="Close">✕</button></h2>
      <div class="tabs">${tabs}</div>
      <div class="sq-body">
        <div class="cards">${cards}</div>
        <div class="editor">
          <canvas id="sqBig" width="260" height="300"></canvas>
          <div class="hint">Drag the picture to turn the player.</div>
          <label class="field">Name <input id="sqName" type="text" maxlength="12" value="${cur.name}" autocomplete="off" spellcheck="false"></label>
          <div class="field">Skin tone <div class="skinbar"><input id="sqSkin" type="range" min="0" max="${SKIN_MAX}" step="0.5" value="${look.skin}"><div class="strip">${skinStrip}</div></div></div>
          <div class="field">Hair colour <div class="sws">${sw(HAIR_COLORS, 'hair', look.hair)}</div></div>
          <div class="field">Hairstyle <div class="opts">${opt(HAIR_STYLES, STYLE_LABELS, 'style', look.style)}</div></div>
          <div class="field">Facial hair <div class="opts">${opt(BEARDS, BEARD_LABELS, 'beard', look.beard)}</div></div>
          <div class="field">Eye colour <div class="sws">${sw(EYE_COLORS, 'eyes', look.eyes)}</div></div>
          <div class="field">Boots <div class="sws">${sw(BOOT_COLORS, 'boots', look.boots)}</div></div>
          <div class="opts">
            <button id="sqRandom">🎲 Randomise</button><button id="sqResetP">Reset player</button><button id="sqResetT">Reset team</button>
          </div>
        </div>
      </div>
    </div>`;
    this.bind();
    this.paintAll();
  }

  paintAll() {
    const r = this.root;
    r.querySelectorAll('.card').forEach((b) => this.paint(b.querySelector('canvas').getContext('2d'), 132, 150, this.team, Number(b.dataset.slot), 0.35));
    const big = r.querySelector('#sqBig');
    this.paint(big.getContext('2d'), 260, 300, this.team, this.slot, this.yaw);
  }

  bind() {
    const r = this.root;
    r.querySelector('#sqClose').onclick = () => this.close();
    r.querySelectorAll('[data-team]').forEach((b) => { b.onclick = () => { this.team = Number(b.dataset.team); this.render(); }; });
    r.querySelectorAll('[data-slot]').forEach((b) => { b.onclick = () => { this.slot = Number(b.dataset.slot); this.render(); }; });
    r.querySelector('#sqSkin').oninput = (e) => this.edit({ skin: Number(e.target.value) }, false);
    r.querySelectorAll('.strip i').forEach((el) => { el.onclick = () => this.edit({ skin: Number(el.dataset.skin) }); });
    r.querySelectorAll('[data-hair]').forEach((b) => { b.onclick = () => this.edit({ hair: b.dataset.hair }); });
    r.querySelectorAll('[data-style]').forEach((b) => { b.onclick = () => this.edit({ style: b.dataset.style }); });
    r.querySelectorAll('[data-beard]').forEach((b) => { b.onclick = () => this.edit({ beard: b.dataset.beard }); });
    r.querySelectorAll('[data-eyes]').forEach((b) => { b.onclick = () => this.edit({ eyes: b.dataset.eyes }); });
    r.querySelectorAll('[data-boots]').forEach((b) => { b.onclick = () => this.edit({ boots: b.dataset.boots }); });
    r.querySelector('#sqName').oninput = (e) => this.editName(e.target.value);
    r.querySelector('#sqRandom').onclick = () => { const l = randomLook(this.team); this.edit({ skin: l.skin, hair: l.hair, style: l.style, beard: l.beard, boots: l.boots, eyes: l.eyes }); };
    r.querySelector('#sqResetP').onclick = () => { delete settings.custom[`${this.team}-${this.slot}`]; this.commit(); };
    r.querySelector('#sqResetT').onclick = () => { for (let s = 0; s < SLOTS; s++) delete settings.custom[`${this.team}-${s}`]; this.commit(); };
    const big = r.querySelector('#sqBig');
    let drag = null;
    big.addEventListener('pointerdown', (e) => { drag = e.clientX; big.setPointerCapture?.(e.pointerId); });
    big.addEventListener('pointerup', () => { drag = null; });
    big.addEventListener('pointermove', (e) => {
      if (drag === null) return;
      this.yaw += (e.clientX - drag) * 0.012; drag = e.clientX;
      this.paint(big.getContext('2d'), 260, 300, this.team, this.slot, this.yaw);
    });
  }

  entry() { return (settings.custom[`${this.team}-${this.slot}`] ||= {}); }

  // Save one or more changed fields; a field equal to the generated default is not stored
  edit(change, rerender = true) {
    const o = this.entry(), base = defaultLook(this.team, this.slot);
    for (const [k, v] of Object.entries(change)) { if (base[k] === v) delete o[k]; else o[k] = v; }
    this.commit(rerender);
  }

  editName(raw) {
    const name = cleanName(raw), o = this.entry();
    if (name) o.name = name; else delete o.name;
    this.commit(false, true);
    const lab = this.root.querySelector('.card.on b');
    if (lab) lab.textContent = `#${squad(this.team)[this.slot].num} ${squad(this.team)[this.slot].name}`;
  }

  commit(rerender = true, nameOnly = false) {
    const key = `${this.team}-${this.slot}`;
    if (settings.custom[key] && !Object.keys(settings.custom[key]).length) delete settings.custom[key];
    saveSettings();
    this.game.refreshSquads();
    if (rerender) { this.render(); return; }
    this.paintAll();
    if (nameOnly) return;
    const cur = squad(this.team)[this.slot];
    this.root.querySelector('#sqSkin')?.setAttribute('value', cur.look.skin);
  }
}
