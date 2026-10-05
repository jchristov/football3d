const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Slash', 'Quote', 'Period', 'Comma']);
export const PAD_ACTIONS = ['up', 'down', 'left', 'right', 'sprint', 'shoot', 'pass', 'tackle', 'swap', 'curl'];
const DEADZONE = 0.22;

// Standard gamepad layout: A pass, B shoot, X tackle, Y switch, LB curl, RB/LT/RT sprint
const PAD_BUTTONS = { 0: 'pass', 1: 'shoot', 2: 'tackle', 3: 'swap', 4: 'curl', 5: 'sprint', 6: 'sprint', 7: 'sprint' };

// Keyboard, gamepad and touch all end up as "codes" in the same sets: keyboard uses KeyboardEvent.code,
// gamepads use `Pad0:shoot`, touch uses `Touch:shoot`. Analog sticks are kept separately.
export class Input {
  constructor(target = typeof window !== 'undefined' ? window : null) {
    this.keys = new Set();
    this.pressed = new Set();
    this.sticks = {};
    this.seen = new Set(); // pad indexes that were read at least once
    this.pads = []; // per pad: { id, x, y, buttons: [bool] } for menu navigation
    if (!target) return;
    // typing into a text field must never trigger game shortcuts
    const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') && e.target.type !== 'range' && e.target.type !== 'checkbox';
    target.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }

  consume(...codes) {
    let hit = false;
    for (const c of codes) if (this.pressed.delete(c)) hit = true;
    return hit;
  }

  endFrame() { this.pressed.clear(); }

  // Programmatic press / release (touch buttons, gamepad)
  setCode(code, on) {
    if (on) { if (!this.keys.has(code)) this.pressed.add(code); this.keys.add(code); } else this.keys.delete(code);
  }

  tap(code) { this.pressed.add(code); }

  setStick(id, x, y) { this.sticks[id] = { x, y }; }

  // Strongest analog input among the given sources: { x, y (down is +), mag }
  stick(ids = []) {
    let best = { x: 0, y: 0, mag: 0 };
    for (const id of ids) {
      const s = this.sticks[id];
      if (!s) continue;
      const mag = Math.hypot(s.x, s.y);
      if (mag > best.mag) best = { x: s.x, y: s.y, mag };
    }
    return best;
  }

  // Read connected gamepads (call once per frame)
  poll() {
    const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    this.pads = [];
    let idx = 0;
    for (const gp of list) {
      if (!gp || !gp.connected) continue;
      if (idx > 1) break;
      this.readPad(gp, idx++);
    }
    for (const i of [...this.seen]) if (i >= idx) { this.releasePad(i); this.seen.delete(i); }
  }

  readPad(gp, i) {
    this.seen.add(i);
    const btn = (n) => !!(gp.buttons[n] && (gp.buttons[n].pressed || gp.buttons[n].value > 0.6));
    let x = gp.axes[0] || 0, y = gp.axes[1] || 0;
    let mag = Math.hypot(x, y);
    if (mag < DEADZONE) { x = y = 0; mag = 0; } else { const k = (Math.min(1, mag) - DEADZONE) / (1 - DEADZONE) / mag; x *= k; y *= k; }
    if (mag === 0) {
      x = (btn(15) ? 1 : 0) - (btn(14) ? 1 : 0);
      y = (btn(13) ? 1 : 0) - (btn(12) ? 1 : 0);
      const l = Math.hypot(x, y);
      if (l > 0) { x /= l; y /= l; }
    }
    this.setStick(`Pad${i}`, x, y);

    const held = {};
    for (const [n, action] of Object.entries(PAD_BUTTONS)) held[action] = held[action] || btn(Number(n));
    held.up = y < -0.4; held.down = y > 0.4; held.left = x < -0.4; held.right = x > 0.4;
    for (const a of PAD_ACTIONS) this.setCode(`Pad${i}:${a}`, !!held[a]);

    // global shortcuts as edges so they reuse the keyboard handlers
    const edge = (n, code) => { const k = `_${i}_${n}`; const now = btn(n); if (now && !this[k]) this.tap(code); this[k] = now; };
    if (i === 0) { edge(9, 'KeyP'); edge(8, 'KeyC'); edge(11, 'KeyV'); }
    this.pads.push({ id: gp.id, x, y, buttons: gp.buttons.map((b) => !!(b.pressed || b.value > 0.6)) });
  }

  releasePad(i) {
    if (!this.sticks[`Pad${i}`] && !PAD_ACTIONS.some((a) => this.keys.has(`Pad${i}:${a}`))) return;
    this.setStick(`Pad${i}`, 0, 0);
    for (const a of PAD_ACTIONS) this.keys.delete(`Pad${i}:${a}`);
  }
}
