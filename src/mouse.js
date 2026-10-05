import * as THREE from 'three';

// Mouse control. The pointer on the canvas is turned into: a point on the pitch (run towards it, aim at it) and the
// virtual keys 'Mouse:shoot' (left button, hold to charge), 'Mouse:pass' (right button, hold for a lob), 'Mouse:tackle'
// (middle button) and 'Mouse:swap' (wheel). Touch screens use the on-screen controls instead (see touch.js).
export const MOUSE_IDLE = 6; // seconds after the last movement before the pointer stops steering the player

const BUTTON_CODE = { 0: 'Mouse:shoot', 2: 'Mouse:pass', 1: 'Mouse:tackle' };

// Where a point of the screen (normalised device coordinates -1..1) meets the pitch plane, or null when it looks at the sky
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), ndc = new THREE.Vector2();
export function screenToGround(camera, x, y) {
  ndc.set(x, y);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
}

// Wire the pointer events of `el` (the game canvas) into `input`. Returns a function that removes them again.
export function bindMouse(input, el, now = () => performance.now() / 1000) {
  const m = input.mouse = { x: 0, y: 0, inside: false, last: -1e9, buttons: new Set(), enabled: true };
  const isMouse = (e) => e.pointerType === 'mouse' || e.pointerType === 'pen';
  const set = (e) => { m.x = e.clientX; m.y = e.clientY; m.last = now(); m.inside = true; };
  const release = () => { for (const b of m.buttons) input.setCode(BUTTON_CODE[b], false); m.buttons.clear(); };
  let lastWheel = 0;
  const on = (type, fn, opts) => { el.addEventListener(type, fn, opts); return () => el.removeEventListener(type, fn, opts); };
  const off = [
    on('pointermove', (e) => { if (isMouse(e)) set(e); }),
    on('pointerdown', (e) => {
      if (!isMouse(e) || !m.enabled) return;
      set(e);
      const code = BUTTON_CODE[e.button];
      if (!code) return;
      e.preventDefault();
      m.buttons.add(e.button);
      input.setCode(code, true);
    }),
    on('pointerup', (e) => { if (!isMouse(e)) return; const code = BUTTON_CODE[e.button]; if (code) { m.buttons.delete(e.button); input.setCode(code, false); } }),
    on('pointerleave', (e) => { if (isMouse(e)) { m.inside = false; release(); } }),
    on('pointercancel', release),
    on('contextmenu', (e) => e.preventDefault()),
    on('wheel', (e) => {
      if (!m.enabled) return;
      e.preventDefault();
      const t = now();
      if (t - lastWheel > 0.18 && e.deltaY !== 0) { lastWheel = t; input.tap('Mouse:swap'); } // one switch per flick of the wheel
    }, { passive: false }),
  ];
  return () => off.forEach((f) => f());
}

// Is the pointer steering at the moment? (moved recently or a button is down, and it is over the canvas)
export const mouseActive = (m, now = performance.now() / 1000) => !!m && m.enabled && m.inside && (m.buttons.size > 0 || now - m.last < MOUSE_IDLE);
