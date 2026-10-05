import { ACTIONS, ACTION_LABELS, SCHEME_LABELS, SHORTCUTS, keyboardKeys, keyLabel } from './controls.js';

const $ = (id) => document.getElementById(id);
const PAD = [['Left stick / D-pad', 'Move'], ['B', 'Shoot'], ['A', 'Pass (hold = lob)'], ['X', 'Slide tackle'], ['Y', 'Switch player'], ['LB', 'Curler'], ['RB / triggers', 'Sprint'], ['Start / Back / R3', 'Pause / Camera / Replay']];

const MOUSE = [['Move the pointer', 'Run towards it (when no key is held)'], ['Left button (hold)', 'Shoot at the pointer, release to kick'], ['Right button (hold)', 'Pass to the pointer (hold = lob)'], ['Middle button', 'Slide tackle'], ['Wheel', 'Switch player'], ['Far pointer', 'Sprints automatically']];
const TOUCH = [['Left side of the screen', 'Drag: floating stick'], ['SHOOT / PASS', 'Hold to charge / lob'], ['TACKLE · SWITCH', 'Tap'], ['SPRINT', 'Hold'], ['CURL', 'Toggle, then shoot'], ['⏸ 🎥 ⏪ 🔁 ⚙', 'Pause, camera, replay, team, settings']];
const kbd = (k) => `<kbd>${k}</kbd>`;
const rows = (list) => list.map(([k, d]) => `<tr><td>${k}</td><td>${d}</td></tr>`).join('');

// The help screen: every shortcut on one page. The keys follow the user's current key bindings.
export class HelpUI {
  constructor() {
    this.root = $('helpScreen');
    this.onClose = null;
    // Capture phase: while the help is open Escape closes only the help, never pauses / un-pauses the game
    window.addEventListener('keydown', (e) => {
      if (this.open && e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.hide(); }
    }, true);
  }

  get open() { return !this.root.classList.contains('hidden'); }

  show(onClose) {
    this.onClose = onClose || null;
    this.render();
    this.root.classList.remove('hidden');
  }

  hide() {
    if (!this.open) return;
    this.root.classList.add('hidden');
    this.onClose?.();
    this.onClose = null;
  }

  render() {
    const scheme = (s) => rows(ACTIONS.map((a) => [keyboardKeys(s, a).map((c) => kbd(keyLabel(c))).join(' '), ACTION_LABELS[a]]));
    this.root.innerHTML = `<div class="panel wide help-panel">
      <h2>Keys &amp; help</h2>
      <div class="help-grid">
        <section><h3>Shortcuts</h3><table>${rows(SHORTCUTS.map(([k, d]) => [k.split(' / ').map(kbd).join(' / '), d]))}</table></section>
        <section><h3>${SCHEME_LABELS.solo}</h3><table>${scheme('solo')}</table></section>
        <section><h3>${SCHEME_LABELS.p1} (2 players)</h3><table>${scheme('p1')}</table></section>
        <section><h3>${SCHEME_LABELS.p2} (2 players)</h3><table>${scheme('p2')}</table></section>
        <section><h3>Gamepad</h3><table>${rows(PAD.map(([k, d]) => [kbd(k), d]))}</table></section>
        <section><h3>Mouse (single player)</h3><table>${rows(MOUSE)}</table></section>
        <section><h3>Touch screen</h3><table>${rows(TOUCH)}</table></section>
      </div>
      <div class="hint">Rebind the movement and action keys in Settings (O). The game is paused while this screen is open.</div>
      <div class="set-opts"><button id="helpDone" class="primary">Close <small>(H)</small></button></div>
    </div>`;
    $('helpDone').onclick = () => this.hide();
  }
}
