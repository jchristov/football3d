// Gamepad navigation for the menus: D-pad / left stick moves the focus between buttons,
// A presses, B goes back, Start confirms the primary action.
const ORDER = ['settings', 'squad', 'tactics', 'tour', 'end', 'pause', 'menu'];
const SELECTOR = 'button:not([disabled]), input[type=range], input[type=checkbox]';
const REPEAT = 0.22;

export class PadNav {
  constructor(input, menu, settingsUI) {
    this.input = input; this.menu = menu; this.settingsUI = settingsUI;
    this.prev = {}; this.cool = 0; this.last = performance.now();
    window.addEventListener('pointermove', () => this.clearFocusClass(), { passive: true });
  }

  root() {
    for (const id of ORDER) { const el = document.getElementById(id); if (el && !el.classList.contains('hidden')) return el; }
    return null;
  }

  clearFocusClass() { document.querySelectorAll('.padfocus').forEach((e) => e.classList.remove('padfocus')); }

  items(root) {
    return [...root.querySelectorAll(SELECTOR)].filter((el) => el.offsetParent !== null && !el.closest('.hidden'));
  }

  rect(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  focus(el) {
    this.clearFocusClass();
    el.classList.add('padfocus');
    el.focus({ preventScroll: false });
    el.scrollIntoView?.({ block: 'nearest' });
  }

  move(root, dx, dy) {
    const items = this.items(root);
    if (!items.length) return;
    const cur = items.find((e) => e === document.activeElement) || null;
    if (!cur) { this.focus(items[0]); return; }
    if (cur.type === 'range' && dx) {
      const step = Number(cur.step) || 1;
      cur.value = String(Math.min(Number(cur.max), Math.max(Number(cur.min), Number(cur.value) + dx * step * 5)));
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const c = this.rect(cur);
    let best = null, bs = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const p = this.rect(el), vx = p.x - c.x, vy = p.y - c.y;
      const along = vx * dx + vy * dy;
      if (along <= 4) continue;
      const across = Math.abs(dx ? vy : vx);
      const score = along + across * 2.2;
      if (score < bs) { bs = score; best = el; }
    }
    if (best) this.focus(best);
  }

  update() {
    const root = this.root();
    const now = performance.now(), dt = (now - this.last) / 1000;
    this.last = now;
    this.cool = Math.max(0, this.cool - dt);
    const pad = this.input.pads[0] || this.input.pads[1];
    if (!root || !pad) { this.prev = {}; return; }
    const b = pad.buttons;
    const edge = (n) => { const on = !!b[n]; const e = on && !this.prev[n]; this.prev[n] = on; return e; };
    const a = edge(0), back = edge(1), start = edge(9);
    const dx = (b[15] ? 1 : 0) - (b[14] ? 1 : 0) || (Math.abs(pad.x) > 0.5 ? Math.sign(pad.x) : 0);
    const dy = (b[13] ? 1 : 0) - (b[12] ? 1 : 0) || (Math.abs(pad.y) > 0.5 ? Math.sign(pad.y) : 0);
    if ((dx || dy) && this.cool === 0) { this.move(root, dx, dy ? 0 : dx, ); if (dy) this.move(root, 0, dy); this.cool = REPEAT; }
    if (a && document.activeElement && root.contains(document.activeElement)) document.activeElement.click();
    if (back) {
      if (this.settingsUI.open) this.settingsUI.hide();
      else if (root.id === 'tour') document.getElementById('tourQuit').click();
      else if (root.id === 'squad') document.getElementById('sqClose')?.click();
      else if (root.id === 'tactics' && this.menu.game.state !== 'halftime') document.getElementById('tacDone')?.click();
    }
    if (start && root.id !== 'settings') this.menu.primary();
  }
}
