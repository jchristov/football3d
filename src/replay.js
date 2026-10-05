import * as THREE from 'three';
import { POSE_LEN } from './player.js';

export const HZ = 30;
const KEEP = 18; // seconds of history
const PSTRIDE = 3 + POSE_LEN; // per player: x, z, rotY, then the animation pose
const FRAMES = HZ * KEEP;
const strideFor = (np) => 7 + np * PSTRIDE;

// Records the visible state of the match (meshes) at 30 Hz into a ring buffer and plays it back.
// A slice of the ring can be copied into a standalone clip (used for "goal of the match").
export class Replay {
  constructor(game) {
    this.game = game;
    this.np = 10;
    this.stride = strideFor(10);
    this.buf = new Float32Array(FRAMES * this.stride);
    this.times = new Float32Array(FRAMES);
    this.count = 0; // frames written (monotonic)
    this.clock = 0; // recording clock (seconds of recorded game time)
    this.acc = 0;
    this.active = false;
    this.clip = null;
    this.q0 = new THREE.Quaternion(); this.q1 = new THREE.Quaternion();
    this.scratch = new Float32Array(POSE_LEN);
  }

  // The number of players on the pitch changes with the team size: re-allocate and start recording afresh
  configure(np) {
    if (np === this.np) return;
    this.np = np;
    this.stride = strideFor(np);
    this.buf = new Float32Array(FRAMES * this.stride);
    this.count = 0; this.acc = 0;
    this.clip = null; this.active = false;
  }

  clear() { this.count = 0; this.acc = 0; }

  get now() { return this.clock; }

  record(dt) {
    this.clock += dt;
    this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc %= 1 / HZ;
    const g = this.game, i = this.count % FRAMES, o = i * this.stride, b = this.buf;
    const m = g.ball.mesh;
    b[o] = m.position.x; b[o + 1] = m.position.y; b[o + 2] = m.position.z;
    b[o + 3] = m.quaternion.x; b[o + 4] = m.quaternion.y; b[o + 5] = m.quaternion.z; b[o + 6] = m.quaternion.w;
    let k = o + 7;
    for (const p of g.roster) {
      b[k++] = p.mesh.position.x; b[k++] = p.mesh.position.z; b[k++] = p.mesh.rotation.y;
      p.getPose(b, k); k += POSE_LEN;
    }
    this.times[i] = this.clock;
    this.count++;
  }

  get oldest() { return this.clock - (Math.min(this.count, FRAMES) - 1) / HZ; }

  // Start playback of [from, to] (recording-clock seconds) from the live ring buffer
  play(from, to, speed = 0.7) {
    this.clip = null;
    this.from = Math.max(from, this.oldest + 0.1);
    this.to = Math.min(to, this.clock);
    if (this.to - this.from < 0.5) return false;
    this.t = this.from;
    this.speed = speed;
    this.active = true;
    return true;
  }

  // Copy [from, to] out of the ring into an independent clip (call right after play())
  extract(from = this.from, to = this.to) {
    const newest = this.count - 1, oldest = Math.max(0, this.count - FRAMES);
    const f0 = Math.max(oldest, newest - Math.round((this.clock - from) * HZ));
    const f1 = Math.min(newest, newest - Math.round((this.clock - to) * HZ));
    const n = f1 - f0 + 1;
    if (n < 2) return null;
    const S = this.stride;
    const buf = new Float32Array(n * S), times = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const src = ((f0 + i) % FRAMES) * S;
      buf.set(this.buf.subarray(src, src + S), i * S);
      times[i] = this.times[(f0 + i) % FRAMES];
    }
    return { buf, times, frames: n, stride: S, np: this.np };
  }

  playClip(clip, speed = 0.6) {
    this.clip = clip;
    this.from = clip.times[0];
    this.to = clip.times[clip.frames - 1];
    this.t = this.from;
    this.speed = speed;
    this.active = true;
    return true;
  }

  get progress() { return (this.t - this.from) / Math.max(0.001, this.to - this.from); }

  stop() { this.active = false; this.clip = null; }

  // Advance playback; returns false once finished
  step(dt) {
    this.t += dt * this.speed;
    if (this.t >= this.to) { this.active = false; return false; }
    this.apply(this.t);
    return true;
  }

  frameAt(t) {
    if (this.clip) return Math.min(this.clip.frames - 1, Math.max(0, Math.round((t - this.clip.times[0]) * HZ)));
    const newest = this.count - 1, oldest = Math.max(0, this.count - FRAMES);
    return Math.min(newest, Math.max(oldest, newest - Math.round((this.clock - t) * HZ)));
  }

  apply(t) {
    const clip = this.clip;
    const total = clip ? clip.frames : this.count;
    const f0 = this.frameAt(t), f1 = Math.min(total - 1, f0 + 1);
    const times = clip ? clip.times : this.times, b = clip ? clip.buf : this.buf;
    const wrap = (f) => (clip ? f : f % FRAMES);
    const t0 = times[wrap(f0)], t1 = times[wrap(f1)];
    const a = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
    const S = clip ? clip.stride : this.stride;
    const A = wrap(f0) * S, B = wrap(f1) * S;
    const L = (i) => b[A + i] + (b[B + i] - b[A + i]) * a;
    const g = this.game, m = g.ball.mesh;
    m.position.set(L(0), L(1), L(2));
    this.q0.set(b[A + 3], b[A + 4], b[A + 5], b[A + 6]);
    this.q1.set(b[B + 3], b[B + 4], b[B + 5], b[B + 6]);
    m.quaternion.slerpQuaternions(this.q0, this.q1, a);
    let k = 7;
    for (const p of g.roster) {
      p.mesh.position.set(L(k), 0, L(k + 1));
      const r0 = b[A + k + 2], r1 = b[B + k + 2];
      p.mesh.rotation.y = r0 + Math.atan2(Math.sin(r1 - r0), Math.cos(r1 - r0)) * a;
      for (let i = 0; i < POSE_LEN; i++) this.scratch[i] = L(k + 3 + i);
      p.setPose(this.scratch, 0);
      k += PSTRIDE;
    }
    this.ballPos = m.position;
  }
}
