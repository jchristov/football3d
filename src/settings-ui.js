import { settings, saveSettings, resetSettings, CPU_TOUGHNESS, clampToughness } from './settings.js';
import { buildBallPicker, buildBallSizePicker } from './ballpicker.js';
import { ACTIONS, ACTION_LABELS, SCHEME_LABELS, SHORTCUTS, keyboardKeys, keyLabel, rebind, resetBindings } from './controls.js';

const $ = (id) => document.getElementById(id);
const QUALITY = { high: 'High', medium: 'Medium', low: 'Low' };
const LENGTHS = [60, 120, 180, 300];

// The settings overlay: audio, graphics, match options and key / gamepad controls.
export class SettingsUI {
  constructor(input, speech) {
    this.input = input;
    this.speech = speech;
    this.root = $('settings');
    this.scheme = 'solo';
    this.listening = null; // { action, button } while waiting for a key
    this.onClose = null;
    this.render();
    // Capture phase: while the overlay is open the game must not see Escape / rebound keys
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  get open() { return !this.root.classList.contains('hidden'); }

  show(onClose) {
    this.onClose = onClose || null;
    this.render();
    this.root.classList.remove('hidden');
  }

  hide() {
    this.listening = null;
    this.root.classList.add('hidden');
    this.onClose?.();
    this.onClose = null;
  }

  onKey(e) {
    if (!this.open) return;
    if (this.listening) {
      e.preventDefault(); e.stopImmediatePropagation();
      const { action, button } = this.listening;
      this.listening = null;
      if (e.code !== 'Escape') {
        if (!rebind(this.scheme, action, e.code)) this.flash(button, 'Reserved key');
        else saveSettings();
      }
      this.renderBindings();
      return;
    }
    if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.hide(); }
  }

  flash(btn, text) { const old = btn.textContent; btn.textContent = text; setTimeout(() => { btn.textContent = old; }, 900); }

  render() {
    const s = settings;
    const slider = (key, label, min = 0) => `<div class="set-row"><label for="s-${key}">${label}</label><input id="s-${key}" type="range" min="${min}" max="100" value="${Math.round(s[key] * 100)}" data-key="${key}"><output>${Math.round(s[key] * 100)}%</output></div>`;
    this.root.innerHTML = `<div class="panel">
      <h2>Settings <button id="setClose" aria-label="Close settings">✕</button></h2>
      <h3>Audio</h3>
      ${slider('master', 'Master volume')}${slider('sfx', 'Effects')}${slider('crowd', 'Crowd')}
      <h3>Ball face</h3>
      <div class="set-opts" id="setBall"></div>
      <h3>Ball size</h3>
      <div class="set-opts" id="setSize"></div>
      <h3>Graphics</h3>
      <div class="set-opts" id="setQuality">${Object.entries(QUALITY).map(([k, v]) => `<button data-q="${k}" class="${s.quality === k ? 'on' : ''}">${v}</button>`).join('')}
        <span class="hint">Low: no shadows, static crowd, fewer particles, 1× resolution.</span></div>
      <div class="set-opts" style="margin-top:3px"><label><input type="checkbox" id="setAutoQ" ${s.autoQuality !== false ? 'checked' : ''}> Lower the quality automatically when the frame rate is poor</label></div>
      ${slider('panelOpacity', 'Panel opacity (all panels)', 30)}
      <h3>Accessibility</h3>
      <div class="set-opts" style="margin-top:3px"><label><input type="checkbox" id="setCb" ${s.colorBlind ? 'checked' : ''}> Colour-blind-safe colours (blue / yellow / orange bars, patterned red cards)</label></div>
      ${slider('uiScale', 'Size of widgets and panels', 80).replace('max="100"', 'max="150"')}
      <div class="set-opts" style="margin-top:3px"><label><input type="checkbox" id="setRm" ${s.reducedMotion ?? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'checked' : ''}> Reduce motion (no animations, no confetti, still crowd)</label></div>
      <h3>Match</h3>
      <div class="set-opts" id="setLength"><span>Friendly match length</span>${LENGTHS.map((l) => `<button data-l="${l}" class="${s.length === l ? 'on' : ''}">${l / 60} min</button>`).join('')}</div>
      <div class="set-opts" id="setTough"><span title="How hard the CPU opponent plays in a 1-player match: its speed, reactions, tackling, shooting and goalkeeping">CPU toughness</span>${CPU_TOUGHNESS.map((l, i) => `<button data-t="${i + 1}" class="${clampToughness(s.cpuToughness) === i + 1 ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="set-opts" style="margin-top:3px"><label><input type="checkbox" id="setComm" ${s.commentary ? 'checked' : ''}> Live text commentary</label></div>
      <div class="set-opts kb-only" style="margin-top:3px"><label><input type="checkbox" id="setMouse" ${s.mouse !== false ? 'checked' : ''}> Mouse control (run to the pointer, left click shoot, right click pass, middle click tackle, wheel switch)</label></div>
      <div class="set-opts" style="margin-top:3px"><label><input type="checkbox" id="setSwap" ${s.swapHalves !== false ? 'checked' : ''}> Teams swap halves after half-time</label></div>
      <div class="set-opts" style="margin-top:3px"><label><input type="checkbox" id="setRestarts" ${s.restarts !== false ? 'checked' : ''}> Throw-ins, corners and goal kicks (off: the ball bounces off the boards)</label></div>
      <div class="set-opts" style="margin-top:3px"><label><input type="checkbox" id="setVar" ${s.var !== false ? 'checked' : ''}> VAR (a video review of penalties and straight red cards can overturn them)</label></div>
      <div class="set-opts" style="margin-top:3px"><label><input type="checkbox" id="setInj" ${s.injuries ? 'checked' : ''}> Injuries (hard challenges can hurt players)</label></div>
      <div class="set-opts" style="margin-top:3px"><label><input type="checkbox" id="setLineup" ${s.lineupScreen ? 'checked' : ''}> Show the team sheets before kick-off</label></div>
      <div class="set-opts" style="margin-top:3px"><label><input type="checkbox" id="setBars" ${s.playerBars ? 'checked' : ''}> Show energy and speciality bars (ball carrier and human players)</label></div>
      <div class="set-opts" style="margin-top:3px"><label><input type="checkbox" id="setClockUp" ${s.clockUp ? 'checked' : ''}> Count the match clock up (elapsed time) instead of down (time left)</label></div>
      <h3>Spoken commentary</h3>
      <div class="set-opts"><label><input type="checkbox" id="setTts" ${s.tts !== false ? 'checked' : ''}> Read the commentary aloud</label></div>
      <div class="set-opts"><label><input type="checkbox" id="setAnn" ${s.announcer !== false ? 'checked' : ''}> Stadium announcer (deeper PA voice: line-ups, goals, cards, substitutions)</label></div>
      <div class="set-row"><label for="setVoice">Voice</label><select id="setVoice"></select><span></span></div>
      <div class="set-row"><label for="s-ttsRate">Speed</label><input id="s-ttsRate" type="range" min="60" max="160" value="${Math.round((s.ttsRate || 1) * 100)}" data-tts="ttsRate"><output>${(s.ttsRate || 1).toFixed(2)}×</output></div>
      <div class="set-row"><label for="s-ttsVolume">Voice volume</label><input id="s-ttsVolume" type="range" min="0" max="100" value="${Math.round((s.ttsVolume ?? 1) * 100)}" data-tts="ttsVolume"><output>${Math.round((s.ttsVolume ?? 1) * 100)}%</output></div>
      <div class="set-opts"><button id="setTtsTest">🔊 Test voice</button><span class="hint" id="ttsStatus"></span></div>
      <div class="touch-only"><h3>Touch controls</h3>
        ${slider('touchScale', 'Size of the buttons', 60).replace('max="100"', 'max="140"')}
        <div class="hint">The stick appears where you touch the left half of the screen; the buttons are on the right. Pause (⏸) has Resume, team changes, settings, camera and autopilot.</div></div>
      <div class="kb-only">
      <h3>Controls</h3>
      <div class="set-opts" id="setScheme">${Object.entries(SCHEME_LABELS).map(([k, v]) => `<button data-s="${k}" class="${this.scheme === k ? 'on' : ''}">${v}</button>`).join('')}
        <button id="setResetKeys">Reset these keys</button></div>
      <div class="bind-grid" id="bindGrid"></div>
      <div class="pad-status" id="padStatus"></div>
      <div class="hint">Gamepad: left stick / D-pad move · B shoot · A pass (hold = lob) · X tackle · Y switch · LB curler · RB / triggers sprint · Start pause · Back camera · R3 replay.
        Touch controls appear automatically on touch devices.</div>
      <div class="shortcuts">${SHORTCUTS.map(([k, d]) => `<span><b>${k}</b> ${d}</span>`).join('')}</div>
      </div>
      <div class="set-opts" style="margin-top:12px"><button id="setReset">Reset all settings</button><button id="setDone" class="primary">Done</button></div>
    </div>`;
    buildBallPicker(this.root.querySelector('#setBall'));
    buildBallSizePicker(this.root.querySelector('#setSize'));
    this.bind();
    this.renderBindings();
  }

  bind() {
    const r = this.root;
    r.querySelector('#setClose').onclick = () => this.hide();
    r.querySelector('#setDone').onclick = () => this.hide();
    r.querySelectorAll('input[type=range]').forEach((el) => {
      el.oninput = () => { settings[el.dataset.key] = el.value / 100; el.nextElementSibling.textContent = `${el.value}%`; saveSettings(); };
    });
    r.querySelectorAll('#setQuality button').forEach((b) => { b.onclick = () => { settings.quality = b.dataset.q; saveSettings(); this.render(); }; });
    r.querySelectorAll('#setLength button').forEach((b) => { b.onclick = () => { settings.length = Number(b.dataset.l); saveSettings(); this.render(); }; });
    r.querySelectorAll('#setTough button').forEach((b) => { b.onclick = () => { settings.cpuToughness = Number(b.dataset.t); saveSettings(); this.render(); }; });
    r.querySelector('#setTts').onchange = (e) => { settings.tts = e.target.checked; if (!settings.tts) this.speech?.stop(); saveSettings(); };
    r.querySelectorAll('input[data-tts]').forEach((el) => {
      el.oninput = () => {
        const k = el.dataset.tts, v = k === 'ttsRate' ? el.value / 100 : el.value / 100;
        settings[k] = v; el.nextElementSibling.textContent = k === 'ttsRate' ? `${v.toFixed(2)}×` : `${el.value}%`; saveSettings();
      };
    });
    r.querySelector('#setTtsTest').onclick = () => { if (!this.speech?.test()) this.flash(r.querySelector('#setTtsTest'), 'No speech support'); };
    r.querySelector('#setVoice').onchange = (e) => { settings.ttsVoice = e.target.value; saveSettings(); this.speech?.test('Voice selected. This is how the commentary will sound.'); };
    this.fillVoices();
    r.querySelector('#setAnn').onchange = (e) => { settings.announcer = e.target.checked; saveSettings(); };
    r.querySelector('#setCb').onchange = (e) => { settings.colorBlind = e.target.checked; saveSettings(); };
    r.querySelector('#setRm').onchange = (e) => { settings.reducedMotion = e.target.checked; saveSettings(); };
    r.querySelector('#setAutoQ').onchange = (e) => { settings.autoQuality = e.target.checked; saveSettings(); };
    r.querySelector('#setMouse').onchange = (e) => { settings.mouse = e.target.checked; saveSettings(); };
    r.querySelector('#setSwap').onchange = (e) => { settings.swapHalves = e.target.checked; saveSettings(); };
    r.querySelector('#setRestarts').onchange = (e) => { settings.restarts = e.target.checked; saveSettings(); };
    r.querySelector('#setVar').onchange = (e) => { settings.var = e.target.checked; saveSettings(); };
    r.querySelector('#setInj').onchange = (e) => { settings.injuries = e.target.checked; saveSettings(); };
    r.querySelector('#setLineup').onchange = (e) => { settings.lineupScreen = e.target.checked; saveSettings(); };
    r.querySelector('#setBars').onchange = (e) => { settings.playerBars = e.target.checked; saveSettings(); };
    r.querySelector('#setClockUp').onchange = (e) => { settings.clockUp = e.target.checked; saveSettings(); };
    r.querySelector('#setComm').onchange = (e) => { settings.commentary = e.target.checked; saveSettings(); };
    r.querySelectorAll('#setScheme button').forEach((b) => { b.onclick = () => { this.scheme = b.dataset.s; this.listening = null; this.render(); }; });
    r.querySelector('#setResetKeys').onclick = () => { resetBindings(this.scheme); saveSettings(); this.renderBindings(); };
    r.querySelector('#setReset').onclick = () => { resetSettings(); resetBindings(); this.render(); };
  }

  // Only Microsoft Natural voices are listed. Voices load asynchronously, so the list is refreshed when they arrive.
  fillVoices() {
    const sel = this.root.querySelector('#setVoice'), status = this.root.querySelector('#ttsStatus'), test = this.root.querySelector('#setTtsTest');
    if (!sel) return;
    if (!this.speech?.supported) {
      sel.innerHTML = '<option>Speech is not supported in this browser</option>'; sel.disabled = true; test.disabled = true;
      status.textContent = 'Use Microsoft Edge for spoken commentary.';
      return;
    }
    const voices = this.speech.voices();
    sel.disabled = test.disabled = !voices.length;
    if (!voices.length) {
      sel.innerHTML = '<option>No Microsoft Natural voices found</option>';
      status.textContent = 'Microsoft Natural voices are available in Microsoft Edge (Windows / macOS) while online.';
      if (!this._voiceSub) this._voiceSub = this.speech.onVoices(() => { if (this.open) this.fillVoices(); });
      return;
    }
    const best = this.speech.voice('');
    const short = (v) => v.name.replace(/^Microsoft\s+/i, '').replace(/\s*Online\s*\(Natural\)\s*-?\s*/i, ' — ').replace(/\s*\(Natural\)\s*-?\s*/i, ' — ').trim();
    const opt = (v) => `<option value="${v.voiceURI}" ${settings.ttsVoice === v.voiceURI ? 'selected' : ''}>${short(v)} (${v.lang})</option>`;
    const en = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('en')), other = voices.filter((v) => !en.includes(v));
    sel.innerHTML = `<option value="" ${settings.ttsVoice ? '' : 'selected'}>Automatic${best ? ` — ${short(best)}` : ''}</option>`
      + (en.length ? `<optgroup label="English">${en.map(opt).join('')}</optgroup>` : '')
      + (other.length ? `<optgroup label="Other languages">${other.map(opt).join('')}</optgroup>` : '');
    status.textContent = `${voices.length} Microsoft Natural voice${voices.length === 1 ? '' : 's'}`;
    if (!this._voiceSub) this._voiceSub = this.speech.onVoices(() => { if (this.open) this.fillVoices(); });
  }

  renderBindings() {
    const grid = this.root.querySelector('#bindGrid');
    grid.innerHTML = '';
    for (const action of ACTIONS) {
      const label = document.createElement('span');
      label.textContent = ACTION_LABELS[action];
      const btn = document.createElement('button');
      btn.textContent = keyboardKeys(this.scheme, action).map(keyLabel).join(' / ');
      btn.onclick = () => {
        grid.querySelectorAll('button.listening').forEach((x) => x.classList.remove('listening'));
        this.listening = { action, button: btn };
        btn.classList.add('listening');
        btn.textContent = 'Press a key… (Esc cancels)';
      };
      grid.append(label, btn);
    }
    const pads = this.input?.pads || [];
    this.root.querySelector('#padStatus').textContent = pads.length ? `🎮 ${pads.length} gamepad${pads.length > 1 ? 's' : ''} connected: ${pads.map((p) => p.id.split('(')[0].trim()).join(', ')}` : '🎮 No gamepad detected — connect one and press any button.';
  }
}
