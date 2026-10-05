import { settings } from './settings.js';

// Spoken commentary through the browser's Web Speech API (speechSynthesis).
// - Speaks the same lines that appear as captions, with the voice / speed / volume chosen in Settings.
// - One voice at a time: an important line (goal, penalty...) interrupts a minor one; minor lines are dropped
//   while something is being said; the newest of the waiting lines is spoken next if it is still fresh.
// - Silent when muted, paused, or switched off. Everything is injectable so it can be tested without a browser.

const FRESH = 3.5; // seconds a waiting line stays worth saying

// Remove things a voice would read out loud as noise: emoji, symbols, the "OG" abbreviation, extra spaces
export function cleanSpeech(text) {
  return String(text || '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/(\d+)\s*-\s*(\d+)/g, '$1 $2') // scores: "3-1" -> "3 1"
    .replace(/\s+/g, ' ')
    .trim();
}

// Only Microsoft's neural ("Natural") voices are offered, e.g. "Microsoft Aria Online (Natural) - English (United States)".
// They ship with Microsoft Edge and sound far better than the classic system voices.
export function isNaturalVoice(v) {
  const name = v?.name || '';
  return /microsoft/i.test(name) && /natural/i.test(name);
}

// Higher = better default: Andrew Multilingual first, then British / US English, then any English, then the rest
export function voiceScore(v) {
  const lang = (v.lang || '').toLowerCase().replace('_', '-');
  let s = 0;
  if (/andrew\s*multilingual/i.test(v.name || '')) s += 100;
  if (lang === 'en-gb') s += 50; else if (lang === 'en-us') s += 45; else if (lang.startsWith('en')) s += 35;
  if (v.localService) s += 3;
  if (v.default) s += 1;
  return s;
}

// Voices sorted for the list: English first, then by language and name
export function sortVoices(list) {
  return [...list].sort((a, b) => {
    const ea = (a.lang || '').toLowerCase().startsWith('en') ? 0 : 1, eb = (b.lang || '').toLowerCase().startsWith('en') ? 0 : 1;
    return ea - eb || (a.lang || '').localeCompare(b.lang || '') || (a.name || '').localeCompare(b.name || '');
  });
}

export class Speech {
  constructor({ synth, Utter, isMuted = () => false, now = () => performance.now() / 1000 } = {}) {
    this.synth = synth !== undefined ? synth : (typeof speechSynthesis !== 'undefined' ? speechSynthesis : null);
    this.Utter = Utter || (typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : null);
    this.isMuted = isMuted;
    this.now = now;
    this.current = null; // { text, prio }
    this.pending = null; // { text, prio, at }
    this.ann = []; // stadium announcements waiting for a quiet moment
    this.listeners = new Set();
    this.log = []; // the last few spoken lines (for tests and debugging)
    if (this.synth && 'onvoiceschanged' in this.synth) {
      const prev = this.synth.onvoiceschanged;
      this.synth.onvoiceschanged = (e) => { prev?.call(this.synth, e); this.listeners.forEach((f) => f()); };
    }
  }

  get supported() { return !!(this.synth && this.Utter); }
  get enabled() { return this.supported && settings.tts !== false && !this.isMuted() && this.hasVoices; }
  // Is at least one Microsoft Natural voice installed? (Voices load asynchronously, so this can change.)
  get hasVoices() { return this.voices().length > 0; }
  get speaking() { return !!this.current; }

  onVoices(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  voices() { return this.supported ? sortVoices((this.synth.getVoices() || []).filter(isNaturalVoice)) : []; }

  // The voice the player chose, or the best English Natural voice when set to automatic (or when the chosen one is gone)
  voice(uri = settings.ttsVoice) {
    const all = this.voices();
    if (!all.length) return null;
    if (uri) { const v = all.find((x) => x.voiceURI === uri); if (v) return v; }
    return [...all].sort((a, b) => voiceScore(b) - voiceScore(a))[0];
  }

  // Say `text`. prio: 1 = chatter, 2 = normal, 3+ = important (interrupts), 5 = goal-level
  speak(text, prio = 1) {
    if (!this.enabled) return false;
    const clean = cleanSpeech(text);
    if (!clean) return false;
    const t = this.now();
    if (this.current) {
      if (prio > this.current.prio) { this.interrupt(); return this.start(clean, prio); }
      if (prio >= 2 && (!this.pending || prio >= this.pending.prio)) this.pending = { text: clean, prio, at: t };
      return false;
    }
    return this.start(clean, prio);
  }

  start(text, prio, opts = {}) {
    const u = new this.Utter(text);
    const v = this.voice();
    if (!v) return false; // never fall back to a non-Natural voice
    u.voice = v; u.lang = v.lang;
    u.rate = Math.min(2, Math.max(0.5, (settings.ttsRate || 1) * (opts.rate || 1)));
    u.volume = Math.min(1, Math.max(0, settings.ttsVolume ?? 1));
    u.pitch = opts.pitch || 1;
    const mine = { text, prio };
    this.current = mine;
    const done = () => {
      if (this.current !== mine) return; // interrupted: the interrupting line owns the state now
      this.current = null;
      const p = this.pending;
      this.pending = null;
      if (p && this.now() - p.at < FRESH) this.start(p.text, p.prio);
      else this.pumpAnnouncements();
    };
    u.onend = done;
    u.onerror = done;
    this.log.push(text); if (this.log.length > 12) this.log.shift();
    try { this.synth.speak(u); } catch { this.current = null; return false; }
    return true;
  }

  // The stadium announcer: a deeper, slower PA voice. His lines wait until the commentator is quiet (they never
  // interrupt, and the oldest are dropped when too many pile up).
  announce(text) {
    if (!this.enabled || settings.announcer === false) return false;
    const clean = cleanSpeech(text);
    if (!clean) return false;
    this.ann.push({ text: clean, at: this.now() });
    while (this.ann.length > 3) this.ann.shift();
    if (!this.current) this.pumpAnnouncements();
    return true;
  }

  pumpAnnouncements() {
    while (this.ann.length && !this.current) {
      const a = this.ann.shift();
      if (this.now() - a.at < 20) this.start(a.text, 1, { pitch: 0.78, rate: 0.92 });
    }
  }

  interrupt() {
    this.current = null;
    this.pending = null;
    this.ann = [];
    try { this.synth?.cancel(); } catch { /* nothing to cancel */ }
  }

  stop() { this.interrupt(); }

  // For the "Test voice" button: always speaks, regardless of the match
  test(text = 'And it is a goal! What a strike from the edge of the box!') {
    if (!this.supported || !this.hasVoices) return false;
    this.interrupt();
    const keep = this.isMuted;
    this.isMuted = () => false;
    const ok = this.start(cleanSpeech(text), 9);
    this.isMuted = keep;
    return ok;
  }
}
