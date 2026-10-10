import { GOAL, PITCH, clamp, attackDir } from './constants.js';
import { settings } from './settings.js';
import { RUN_AT } from './touch.js';

const PICK_LOCK = 3; // seconds

export const ACTIONS = ['up', 'down', 'left', 'right', 'sprint', 'shoot', 'curl', 'pass', 'tackle', 'swap'];
export const ACTION_LABELS = {
  up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right', sprint: 'Sprint', shoot: 'Shoot (hold)',
  curl: 'Curler modifier', pass: 'Pass (hold = lob)', tackle: 'Slide tackle', swap: 'Switch player',
};
export const SCHEME_LABELS = { solo: 'Single player', p1: 'Player 1', p2: 'Player 2' };
// Keys with a fixed global meaning
export const RESERVED = new Set(['KeyC', 'KeyP', 'KeyV', 'KeyT', 'KeyN', 'KeyM', 'KeyO', 'KeyB', 'KeyH', 'KeyU', 'KeyI', 'KeyG', 'KeyX', 'Escape']);
// Global shortcuts shown in Settings and on the help screen (S is "move down" in the WASD scheme, so Settings is O)
export const SHORTCUTS = [
  ['C', 'Camera: broadcast, selected player, ball, bird\'s-eye'], ['V', 'Instant replay'], ['T', 'Autopilot'], ['N', 'Commentary'], ['P / Esc', 'Pause'], ['M', 'Mute'],
  ['B', 'Bird\'s-eye minimap'], ['H', 'This help screen'], ['O', 'Settings (options)'], ['U', 'Team changes: formation and substitutions'], ['I', 'Match events: goals, cards, substitutions'], ['G', 'Player bars: energy and speciality'], ['X', 'Full screen'], ['Space / Enter', 'Skip a replay'], ['Enter', 'Confirm menus'],
];

export const DEFAULT_KEYS = {
  solo: {
    up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', 'ShiftRight'], shoot: ['Space'], pass: ['KeyF'], tackle: ['KeyE'], swap: ['KeyQ', 'Tab'], curl: ['KeyR'],
  },
  p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], sprint: ['ShiftLeft'], shoot: ['Space'], pass: ['KeyF'], tackle: ['KeyE'], swap: ['KeyQ'], curl: ['KeyR'] },
  // the friend in an online match: the host injects these virtual keys (see net/session.js)
  net: { up: ['Net:up'], down: ['Net:down'], left: ['Net:left'], right: ['Net:right'], sprint: ['Net:sprint'], shoot: ['Net:shoot'], pass: ['Net:pass'], tackle: ['Net:tackle'], swap: ['Net:swap'], curl: ['Net:curl'] },
  p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], sprint: ['ShiftRight'], shoot: ['Enter'], pass: ['Period'], tackle: ['Comma'], swap: ['Slash'], curl: ['Quote'] },
};

// Gamepads and touch are always available next to the (rebindable) keyboard keys
const SOURCES = { solo: ['Pad0', 'Pad1', 'Touch', 'Mouse'], p1: ['Pad0'], p2: ['Pad1'], net: [] };

// Live objects: controllers keep a reference, applyBindings() updates them in place.
export const SCHEMES = { solo: {}, p1: {}, p2: {}, net: {} };

export function keyboardKeys(scheme, action) {
  return settings.bindings?.[scheme]?.[action] ?? DEFAULT_KEYS[scheme][action];
}

export function applyBindings() {
  for (const s of Object.keys(SCHEMES)) {
    const sch = SCHEMES[s];
    for (const a of ACTIONS) sch[a] = [...keyboardKeys(s, a), ...SOURCES[s].map((id) => `${id}:${a}`)];
    sch.sticks = SOURCES[s];
  }
}

// Bind `code` to `action`; a key already used by another action in the scheme swaps places.
// Returns false when the key is reserved.
export function rebind(scheme, action, code) {
  if (RESERVED.has(code)) return false;
  const b = (settings.bindings[scheme] ||= {});
  const current = ACTIONS.map((a) => [a, [...keyboardKeys(scheme, a)]]);
  const old = keyboardKeys(scheme, action);
  for (const [a, keys] of current) {
    if (a !== action && keys.includes(code)) {
      const rest = keys.filter((k) => k !== code);
      b[a] = rest.length ? rest : [old[0] ?? code];
    }
  }
  b[action] = [code];
  applyBindings();
  return true;
}

export function resetBindings(scheme) {
  if (scheme) delete settings.bindings[scheme]; else settings.bindings = {};
  applyBindings();
}

export function keyLabel(code) {
  const map = { Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt', Enter: 'Enter', Tab: 'Tab', Period: '.', Comma: ',',
    Slash: '/', Quote: "'", Semicolon: ';', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`' };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return code;
}

applyBindings();

const LOB_HOLD = 0.28;

// One human-controlled side: owns the "current player" selection and turns input into actions.
export class Controller {
  constructor(game, team, scheme) {
    this.game = game;
    this.team = team;
    this.keys = SCHEMES[scheme];
    this.player = null;
    this.enabled = true;
    this.passHold = 0;
    this.aimZ = 0;
  }

  get dir() { return attackDir(this.team); }

  reset() {
    if (this.player) this.player.charge = 0;
    this.passHold = 0;
    this.aimZ = 0;
  }

  select(force = false) {
    const g = this.game, b = g.ball.pos, cur = this.player;
    const mates = g.teams[this.team].filter((p) => !p.isGK);
    const dd = (p) => Math.hypot(p.pos.x - b.x, p.pos.z - b.z);
    if (!force && cur && g.ball.owner === cur && cur.stunT <= 0) return;
    if (!force && cur && this.lockT > 0 && cur.stunT <= 0) return; // the player picked him by touch: no automatic switch for a moment
    let best = mates[0];
    for (const p of mates) if (dd(p) < dd(best)) best = p;
    if (!cur || force || cur.stunT > 0 || (best !== cur && dd(best) + 2.5 < dd(cur))) {
      if (cur) cur.charge = 0;
      this.player = best;
    }
  }

  // Take control of `p` (a tap on him); the automatic selection leaves him alone for a few seconds
  pick(p) {
    if (!p || p === this.player || p.isGK || p.team !== this.team) return false;
    if (this.player) this.player.charge = 0;
    this.player = p;
    this.lockT = PICK_LOCK;
    this.passHold = 0;
    return true;
  }

  swap() {
    const g = this.game, b = g.ball.pos;
    if (!this.player) return;
    const others = g.teams[this.team].filter((p) => !p.isGK && p !== this.player)
      .sort((a, c) => Math.hypot(a.pos.x - b.x, a.pos.z - b.z) - Math.hypot(c.pos.x - b.x, c.pos.z - b.z));
    if (others[0]) { this.player.charge = 0; this.player = others[0]; }
  }

  // The point on the pitch the mouse points at, when mouse control is in use for this controller (single player only)
  mouseTarget() {
    const g = this.game, p = this.player;
    if (this.keys !== SCHEMES.solo || !p || settings.mouse === false || !g.mouseGround || !g.mouseOn) return null;
    const dx = g.mouseGround.x - p.pos.x, dz = g.mouseGround.z - p.pos.z;
    return { dx, dz, d: Math.hypot(dx, dz) };
  }

  // Screen-relative movement vector from the sticks (analog), direction keys or the mouse pointer
  moveVector() {
    const inp = this.game.input, k = this.keys, f = this.game.camForward, r = { x: -f.z, z: f.x };
    let fwd = (inp.down(...k.up) ? 1 : 0) - (inp.down(...k.down) ? 1 : 0);
    let rgt = (inp.down(...k.right) ? 1 : 0) - (inp.down(...k.left) ? 1 : 0);
    let mag = 1;
    const st = inp.stick(k.sticks);
    if (st.mag > 0) { fwd = -st.y; rgt = st.x; mag = Math.min(1, st.mag); }
    let dx = f.x * fwd + r.x * rgt, dz = f.z * fwd + r.z * rgt;
    const l = Math.hypot(dx, dz);
    if (l > 0) { dx /= l; dz /= l; return { dx: dx * mag, dz: dz * mag, l: mag }; }
    // no keys or sticks: run towards the mouse pointer, slowing down as the player gets there
    const t = this.mouseTarget();
    if (t && t.d > 0.8) { const m = Math.min(1, 0.35 + (t.d - 0.8) / 2.5); return { dx: (t.dx / t.d) * m, dz: (t.dz / t.d) * m, l: m, mouse: true }; }
    return { dx: 0, dz: 0, l: 0 };
  }

  // Direction of the pointer from the player (aim for shots and passes), or null when the pointer is on top of him
  mouseAim() {
    const t = this.mouseTarget();
    return t && t.d > 1.5 ? Math.atan2(t.dz, t.dx) : null;
  }

  update(dt) {
    const g = this.game, p = this.player, inp = g.input, k = this.keys;
    if (!p || !this.enabled) return;
    if (this.lockT > 0) this.lockT -= dt;
    if (inp.consume(...k.swap)) { this.swap(); this.lockT = 0; }

    const mv = this.moveVector(), { dx, dz, l } = mv;
    const aim = this.mouseAim();
    p.speedMul = 1;
    const charging = inp.down(...k.shoot);
    const t = this.mouseTarget();
    const ts = inp.sticks?.Touch;
    const edge = !!ts && Math.hypot(ts.x, ts.y) >= RUN_AT; // touch stick pushed to its edge
    const sprint = inp.down(...k.sprint) || edge || !!(mv.mouse && t.d > 11 * Math.sqrt(PITCH.s) && p.stamina > 0.35); // far pointer: run flat out
    p.move(dx, dz, sprint, dt, charging ? 0.7 : 1);

    if (charging) p.charge = Math.min(1, p.charge + dt / 0.9);
    else if (p.charge > 0) {
      if (aim !== null) p.facing = aim; // shoot where the pointer is
      if (!g.humanHeader(p, Math.max(0.15, p.charge), aim ?? (l > 0 ? Math.atan2(dz, dx) : null), false)) g.humanShoot(p, Math.max(0.12, p.charge), inp.down(...k.curl));
      p.charge = 0;
    }

    if (inp.down(...k.pass)) this.passHold += dt;
    else if (this.passHold > 0) {
      const want = aim ?? (l > 0 ? Math.atan2(dz, dx) : null);
      if (!g.humanHeader(p, 0.5, want, true)) g.humanPass(p, want, this.passHold > LOB_HOLD);
      this.passHold = 0;
    }

    if (inp.consume(...k.tackle) && p.startLunge(l > 0 ? Math.atan2(dz, dx) : p.facing)) g.sfx.tackle();
  }

  // Penalty taker: left/right aims at the goal, hold shoot for power (a full bar skies it)
  updatePenalty(dt, kicker) {
    const g = this.game, inp = g.input, k = this.keys;
    kicker.move(0, 0, false, dt);
    let rgt = (inp.down(...k.right) ? 1 : 0) - (inp.down(...k.left) ? 1 : 0);
    const st = inp.stick(k.sticks);
    if (st.mag > 0) rgt = st.x;
    this.aimZ = clamp(this.aimZ + rgt * this.dir * 4.5 * dt, -GOAL.hw + 0.45, GOAL.hw - 0.45);
    if (inp.down(...k.shoot)) kicker.charge = Math.min(1, kicker.charge + dt / 1.1);
    else if (kicker.charge > 0) {
      const c = Math.max(0.15, kicker.charge);
      kicker.charge = 0;
      g.rules.penaltyShot(kicker, this.aimZ, c);
    }
  }
}

// The remote friend's player: the movement vector arrives ready-made (computed on the friend's screen) and the other
// controls arrive as virtual 'Net:*' keys, so everything else in Controller works unchanged.
export class RemoteController extends Controller {
  constructor(game, team) { super(game, team, 'net'); this.mv = { dx: 0, dz: 0, l: 0 }; }
  moveVector() { return this.mv; }
}
