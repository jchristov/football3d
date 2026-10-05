// Frame-rate watchdog: when the game cannot keep up (several seconds in a row well below 40 fps) it advises lowering the
// graphics quality one step. It only ever goes down, so the quality never flips back and forth.
export class FpsGovernor {
  constructor({ lowFps = 38, windows = 3, windowSec = 2, warmup = 4 } = {}) {
    Object.assign(this, { lowFps, windows, windowSec, warmup });
    this.reset();
  }

  reset() { this.t = 0; this.frames = 0; this.bad = 0; this.age = 0; this.fps = 0; }

  // dt in seconds; `active` is false while paused / hidden (those frames say nothing). Returns true when quality should go down.
  update(dt, active = true) {
    if (!active || dt > 0.25 || dt <= 0) { this.t = 0; this.frames = 0; return false; } // stalls (tab switches, loading) are not slow rendering
    this.age += dt;
    if (this.age < this.warmup) return false;
    this.t += dt; this.frames++;
    if (this.t < this.windowSec) return false;
    this.fps = this.frames / this.t;
    this.t = 0; this.frames = 0;
    this.bad = this.fps < this.lowFps ? this.bad + 1 : 0;
    if (this.bad >= this.windows) { this.reset(); return true; }
    return false;
  }
}

export const NEXT_LOWER = { high: 'medium', medium: 'low', low: null };
