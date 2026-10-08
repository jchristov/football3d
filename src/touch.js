import { bindTapSelect } from './tapselect.js';

const STICK_RADIUS = 46;
export const RUN_AT = 0.92; // pushing the stick to its edge is a sprint (no sprint button)
const HINT = 'Drag on the left to run (to the edge = sprint) · tap a player to control him · SHOOT / PASS on the right · ⚙ top right = settings';
// Buttons in units of --tbu (the size of a small button, set in CSS from the screen height); right / bottom are the offsets from the corner
const BUTTONS = [
  { action: 'shoot', label: 'SHOOT', big: true, right: 0.2, bottom: 0.25 },
  { action: 'pass', label: 'PASS', right: 1.75, bottom: 0.3 },
  { action: 'tackle', label: 'TACKLE', right: 0.45, bottom: 1.8 },
  { action: 'swap', label: 'SWITCH', right: 1.95, bottom: 1.55 },
  { action: 'curl', label: 'CURL', right: 3.2, bottom: 0.45, toggle: true, small: true },
];

export { touchWanted } from './device.js';

// On-screen joystick and buttons that feed the same input codes as a gamepad ("Touch:shoot", ...)
export class TouchControls {
  constructor(input, hudRoot) {
    this.input = input;
    this.curlOn = false;
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.innerHTML = '<div class="zone"></div><div class="knob"><i></i></div><div class="mini"><button data-k="KeyP" aria-label="Pause">⏸</button><button data-k="KeyC" aria-label="Camera">🎥</button><button data-k="KeyV" aria-label="Instant replay">⏪</button><button data-k="KeyT" class="auto" aria-label="Autopilot">🤖</button></div>';
    hudRoot.appendChild(root);
    this.zone = root.querySelector('.zone');
    this.knob = root.querySelector('.knob');
    this.knobDot = this.knob.querySelector('i');
    this.bindStick();
    bindTapSelect(this.zone, (x, y) => this.onTap?.(x, y)); // a tap on a player (also in the stick area)
    for (const def of BUTTONS) this.addButton(def);
    root.querySelectorAll('.mini button').forEach((b) => b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.tap(b.dataset.k);
    }));
    document.body.classList.add('touch');
  }

  bindStick() {
    const { zone, knob, knobDot, input } = this;
    let id = null, ox = 0, oy = 0;
    const set = (x, y) => input.setStick('Touch', x, y);
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      try { zone.setPointerCapture(id); } catch { /* synthetic pointer */ }
      ox = e.clientX; oy = e.clientY;
      knob.style.display = 'block'; knob.style.left = `${ox}px`; knob.style.top = `${oy}px`;
      knobDot.style.transform = 'translate(0,0)';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = (e.clientX - ox) / STICK_RADIUS, dy = (e.clientY - oy) / STICK_RADIUS;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      knobDot.style.transform = `translate(${dx * STICK_RADIUS * 0.7}px, ${dy * STICK_RADIUS * 0.7}px)`;
      knob.classList.toggle('run', l >= RUN_AT);
      set(l < 0.15 ? 0 : dx, l < 0.15 ? 0 : dy);
    });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.display = 'none'; knob.classList.remove('run'); set(0, 0); };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  addButton({ action, label, big, small, right, bottom, toggle }) {
    const el = document.createElement('div');
    el.className = `tb${big ? ' big' : ''}${small ? ' small' : ''}`;
    el.dataset.a = action;
    el.textContent = label;
    el.style.right = `calc(var(--tbu) * ${right})`; el.style.bottom = `calc(var(--tbu) * ${bottom})`;
    const code = `Touch:${action}`;
    const input = this.input;
    if (toggle) {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.setCurl(!this.curlOn, el); });
    } else {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ } el.classList.add('on'); input.setCode(code, true); navigator.vibrate?.(8); });
      const up = () => {
        el.classList.remove('on'); input.setCode(code, false);
        if (action === 'shoot' && this.curlOn) setTimeout(() => this.setCurl(false, this.curlEl), 150); // the shot is read next frame
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }
    if (toggle) this.curlEl = el;
    this.root.appendChild(el);
  }

  // What the player is doing decides which buttons matter: 'ball' (shoot, pass), 'chase' (tackle, switch) or 'idle'
  setContext(mode) {
    if (this.ctx === mode) return;
    this.ctx = mode;
    this.root.dataset.ctx = mode;
  }

  // A short hint over the pitch: how to play with the touch controls
  hint(ms = 7000) {
    this.hintEl?.remove();
    const el = this.hintEl = document.createElement('div');
    el.id = 'touchHint'; el.textContent = HINT;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), ms);
    el.addEventListener('pointerdown', () => el.remove());
  }

  setCurl(on, el) {
    this.curlOn = on;
    el?.classList.toggle('on', on);
    this.input.setCode('Touch:curl', on);
  }
}
