const STICK_RADIUS = 56;
const BUTTONS = [
  { action: 'shoot', label: 'SHOOT', big: true, right: 26, bottom: 30 },
  { action: 'pass', label: 'PASS', right: 130, bottom: 40 },
  { action: 'tackle', label: 'TACKLE', right: 26, bottom: 136 },
  { action: 'sprint', label: 'SPRINT', right: 130, bottom: 124 },
  { action: 'swap', label: 'SWITCH', right: 224, bottom: 78 },
  { action: 'curl', label: 'CURL', right: 224, bottom: 164, toggle: true },
];

export function touchWanted() {
  if (typeof window === 'undefined') return false;
  return /[?&]touch=1/.test(window.location.search) || !!window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
}

// On-screen joystick and buttons that feed the same input codes as a gamepad ("Touch:shoot", ...)
export class TouchControls {
  constructor(input, hudRoot) {
    this.input = input;
    this.curlOn = false;
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.innerHTML = '<div class="zone"></div><div class="knob"><i></i></div><div class="mini"><button data-k="KeyP">⏸</button><button data-k="KeyC">🎥</button><button data-k="KeyV">⏪</button><button data-k="KeyU">🔁</button><button data-k="KeyO">⚙</button></div>';
    hudRoot.appendChild(root);
    this.zone = root.querySelector('.zone');
    this.knob = root.querySelector('.knob');
    this.knobDot = this.knob.querySelector('i');
    this.bindStick();
    for (const def of BUTTONS) this.addButton(def);
    root.querySelectorAll('.mini button').forEach((b) => b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (b.dataset.k === 'KeyO' || b.dataset.k === 'KeyU') window.dispatchEvent(new KeyboardEvent('keydown', { code: b.dataset.k })); // opens the settings / team panel
      else input.tap(b.dataset.k);
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
      set(l < 0.15 ? 0 : dx, l < 0.15 ? 0 : dy);
    });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.display = 'none'; set(0, 0); };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  addButton({ action, label, big, right, bottom, toggle }) {
    const el = document.createElement('div');
    el.className = `tb${big ? ' big' : ''}`;
    el.textContent = label;
    el.style.right = `${right}px`; el.style.bottom = `${bottom}px`;
    const code = `Touch:${action}`;
    const input = this.input;
    if (toggle) {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.setCurl(!this.curlOn, el); });
    } else {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ } el.classList.add('on'); input.setCode(code, true); });
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

  setCurl(on, el) {
    this.curlOn = on;
    el?.classList.toggle('on', on);
    this.input.setCode('Touch:curl', on);
  }
}
