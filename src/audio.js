import { settings, onSettings, saveSettings } from './settings.js';

// Sound effects (ball, whistle, post) are synthesised with WebAudio.
// The crowd uses real recordings from public/audio (see CREDITS.md).
const CLIPS = {
  bed: 'bed.mp3',
  goal: ['goal1.mp3', 'goal2.mp3', 'goal3.mp3'],
  chance: ['chance.mp3', 'chance2.mp3'],
  // goal frame: posts get a lighter knock, the crossbar a heavier clang
  post: ['post_hit_03.mp3', 'post_hit_05.mp3'],
  bar: ['post_slam_01.mp3', 'post_hit_03.mp3'],
};
export const CROWD_BASE = 0.55, CROWD_RANGE = 0.6;

// Equal-power crossfade of the tail into the head so the buffer loops seamlessly
function makeLoop(ctx, buf, fadeSec) {
  const n = Math.floor(fadeSec * buf.sampleRate), len = buf.length - n;
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c), dst = out.getChannelData(c);
    dst.set(src.subarray(0, len));
    for (let i = 0; i < n; i++) {
      const w = i / n;
      dst[i] = src[i] * Math.sin(w * Math.PI / 2) + src[len + i] * Math.cos(w * Math.PI / 2);
    }
  }
  return out;
}

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = !!settings.muted;
    this.onMuteChange = () => {};
    onSettings(() => this.applyVolumes());
  }

  masterLevel() { return this.muted ? 0 : settings.master; }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.masterLevel(), t, 0.03);
    this.sfxBus.gain.setTargetAtTime(settings.sfx, t, 0.03);
    this.crowdBus.gain.setTargetAtTime(settings.crowd, t, 0.03);
  }

  init() {
    if (this.ctx) { if (!this.muted) this.ctx.resume?.(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.masterLevel();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = settings.sfx; this.sfxBus.connect(this.master);
    this.crowdBus = ctx.createGain(); this.crowdBus.gain.value = settings.crowd; this.crowdBus.connect(this.master);
    if (this.muted) ctx.suspend?.();
    // Browsers may suspend or interrupt audio (tab in the background, device change): recover on the next gesture
    ctx.onstatechange = () => { if (ctx.state !== 'running' && !this.muted) this.armResume(); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !this.muted && ctx.state !== 'running') ctx.resume?.(); });

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    setTimeout(() => this.setWeather(this.weather ?? 'clear'));
    this.crowdGain.connect(this.crowdBus);
    this.buildCrowd().catch((e) => console.warn('crowd audio unavailable', e));
  }

  // Resume the audio context at the next user gesture (autoplay rules allow it only then)
  armResume() {
    if (this._armed) return;
    this._armed = true;
    const go = () => {
      this._armed = false;
      for (const e of ['pointerdown', 'keydown']) window.removeEventListener(e, go, true);
      if (!this.muted) this.ctx?.resume?.();
    };
    for (const e of ['pointerdown', 'keydown']) window.addEventListener(e, go, true);
  }

  async load(name) {
    const res = await fetch(import.meta.env.BASE_URL + 'audio/' + name);
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return this.ctx.decodeAudioData(await res.arrayBuffer());
  }

  async buildCrowd() {
    const ctx = this.ctx;
    // each clip is loaded on its own: a missing file must never silence the rest
    const safe = (name) => this.load(name).catch((e) => { console.warn('audio clip unavailable', name, e); return null; });
    const [bed, goal, chance, post, bar] = await Promise.all([
      safe(CLIPS.bed),
      Promise.all(CLIPS.goal.map(safe)),
      Promise.all(CLIPS.chance.map(safe)),
      Promise.all(CLIPS.post.map(safe)),
      Promise.all(CLIPS.bar.map(safe)),
    ]);
    this.goalClips = goal.filter(Boolean);
    this.chanceClips = chance.filter(Boolean);
    this.postClips = post.filter(Boolean);
    this.barClips = bar.filter(Boolean);
    if (!bed) { this.crowdReady = true; return; }
    const src = ctx.createBufferSource();
    src.buffer = makeLoop(ctx, bed, 1.5);
    src.loop = true;
    src.connect(this.crowdGain);
    src.start();
    this.crowdReady = true;
    this.setCrowd(this.level ?? 0);
  }

  play(buf, vol, attack, delay = 0, pitch = 1) {
    if (!this.ctx || this.muted || !buf) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = pitch;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    s.connect(g).connect(this.crowdBus);
    s.start(t);
  }

  // Muting silences the master bus, suspends the whole audio context and stops new sounds being queued
  // Rain is the one place where filtered noise is the right sound
  setWeather(w) {
    this.weather = w;
    if (!this.ctx) return;
    if (!this.rainGain) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7500;
      this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
      src.connect(hp).connect(lp).connect(this.rainGain).connect(this.sfxBus);
      src.start();
    }
    this.rainGain.gain.setTargetAtTime(w === 'rain' ? 0.1 : 0, this.ctx.currentTime, 0.5);
  }

  toggleMute() {
    this.muted = !this.muted;
    settings.muted = this.muted;
    saveSettings();
    if (this.master) this.master.gain.value = this.masterLevel();
    if (this.ctx) { if (this.muted) this.ctx.suspend?.(); else this.ctx.resume?.(); }
    this.onMuteChange(this.muted);
    return this.muted;
  }

  setCrowd(level) {
    this.level = level;
    if (!this.ctx || !this.crowdReady) return;
    this.crowdGain.gain.setTargetAtTime(CROWD_BASE + level * CROWD_RANGE, this.ctx.currentTime, 0.4);
  }

  burst(freq, dur, vol, type = 'lowpass', q = 0.7) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  tone(freq, dur, vol, type = 'sine', slideTo) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  kick(power = 0.5) {
    this.burst(900 + power * 600, 0.09, 0.5 + power * 0.4);
    this.tone(140, 0.12, 0.5 + power * 0.3, 'sine', 60);
  }
  bounce(v) { this.tone(110, 0.1, Math.min(0.5, v / 30), 'sine', 60); }
  // Ball hits the goal frame. v = speed of the impact. Real recordings of a metal knock, never a pure tone.
  post(v = 10, crossbar = false) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (now < (this.nextPost ?? 0)) return;
    this.nextPost = now + 0.12;
    const vol = Math.min(1, 0.35 + v / 22);
    const clips = crossbar ? this.barClips : this.postClips;
    if (clips?.length) {
      const buf = clips[Math.floor(Math.random() * clips.length)];
      this.playSfx(buf, vol * 0.9, crossbar ? 0.95 + Math.random() * 0.1 : 1 + Math.random() * 0.12);
    } else this.burst(crossbar ? 900 : 1500, 0.12, 0.4 * vol, 'bandpass', 1.2); // until the samples have loaded
    this.burst(220, 0.1, 0.35 * vol); // the dull thump of the ball itself
    if (v > 9) this.ooh();
  }

  // One-shot sample on the effects bus
  playSfx(buf, vol = 1, rate = 1) {
    if (!this.ctx || this.muted || !buf) return;
    const ctx = this.ctx, s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buf; s.playbackRate.value = rate; g.gain.value = vol;
    s.connect(g).connect(this.sfxBus);
    s.start();
  }
  save() { this.burst(500, 0.12, 0.6); }
  tackle() { this.burst(300, 0.18, 0.5); }

  // One blast of a referee's whistle: pea whistle = sine around 2.9 kHz with a fast tremolo
  blast(dur, delay = 0, vol = 0.28, freq = 2900) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.linearRampToValueAtTime(freq * 0.985, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 38;
    const lg = ctx.createGain();
    lg.gain.value = 90;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + dur - 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }

  whistle(long = false) { this.blast(long ? 1.1 : 0.45); }

  // The referee's final whistle (end of a half and of the match): peep, peep, peeeeep
  finalWhistle() {
    this.blast(0.32, 0, 0.34);
    this.blast(0.32, 0.46, 0.34);
    this.blast(1.5, 0.92, 0.36, 2850);
  }

  cheer() {
    if (!this.ctx || this.muted) return;
    const clips = this.goalClips;
    if (!clips) return;
    const pick = () => clips[Math.floor(Math.random() * clips.length)];
    this.play(pick(), 1, 0.2);
    this.play(pick(), 0.45, 0.4, 1.2);
  }

  // Crowd gasps / murmurs of interest; rate-limited so chances don't stack up
  ooh(vol = 0.6) {
    if (!this.ctx || this.muted || !this.chanceClips) return;
    const now = this.ctx.currentTime;
    if (now < (this.nextOoh ?? 0)) return;
    this.nextOoh = now + 4;
    this.play(this.chanceClips[Math.floor(Math.random() * this.chanceClips.length)], vol, 0.25);
  }

  groan() { this.ooh(0.5); }
}
