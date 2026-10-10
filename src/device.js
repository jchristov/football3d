// Keyboard-less devices (phones, tablets): there is no keyboard to press shortcuts on, so the game shows touch controls and
// buttons for everything, and hides the keys, key bindings and shortcut hints. `?touch=1` forces this on a computer (for testing).
export const keyboardless = () => {
  if (typeof window === 'undefined') return false;
  return /[?&]touch=1/.test(window.location?.search || '') || !!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
};

// Touch controls (stick and buttons): on keyboard-less devices at once, on other devices at the first touch (see main.js)
export const touchWanted = keyboardless;

// Body classes for the CSS: `nokb` = no keyboard (hides `.kb-only`, shows `.touch-only`), `touch` = touch controls are shown
export function applyDevice(body = document.body) {
  const nokb = keyboardless();
  body.classList.toggle('nokb', nokb);
  if (nokb) body.classList.add('touch');
  return nokb;
}

// Scale of the on-screen widgets for the height of the screen: a phone held sideways is only ~360-430 px tall
export const phoneFactor = (height) => Math.min(1, Math.max(0.55, height / 640));
// Zoom of the panels (menus, settings ...) on a phone: everything in them (text, buttons, spacing) gets smaller
export const panelZoom = (height) => Math.min(0.88, Math.max(0.68, height / 520));
// Zoom of the panels on a computer: compact, so menus and settings need little scrolling
export const DESKTOP_PANEL_ZOOM = 0.85;
