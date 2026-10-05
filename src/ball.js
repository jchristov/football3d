import * as THREE from 'three';
import { PITCH, GOAL, BALL, BALL_R, setBallSize, GRAVITY } from './constants.js';
import { ballTexture, applyFaceMaterial, pickRandomFace, isFace, DEFAULT_FACE, RANDOM_FACE } from './ballskin.js';
import { settings, onSettings } from './settings.js';

export class Ball {
  constructor() {
    this.walls = true; // boards around the pitch; off = the ball can go out of play (throw-ins, corners, goal kicks)
    this.pos = new THREE.Vector3(0, BALL.r, 0);
    this.vel = new THREE.Vector3();
    this.owner = null;
    this.lastToucher = null;
    this.held = null;
    this.netSide = 0;
    this.spin = 0;
    this.roll = 1;
    this.onEvent = () => {};
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 40, 28), // unit size: scaled by BALL.r / BALL_R
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.45 }),
    );
    this.pref = null; // what the player chose (a face or 'random')
    this.face = null; // the face on the ball right now
    this._tok = 0;
    this.setSize(settings.ballSize);
    this.setFace(settings.ball);
    onSettings((s) => { this.setFace(s.ball); this.setSize(s.ballSize); });
    this.mesh.castShadow = true;
    this._axis = new THREE.Vector3();
  }

  // After the keeper's pose is updated for this frame, put the ball exactly between his hands
  attach() {
    const p = this.held;
    if (!p || !p.carryOk || this.heldN < 3) return;
    this.pos.copy(p.carry);
    this.mesh.position.copy(this.pos);
  }

  // The player's choice; 'random' picks a face now and again for every new match
  setFace(pref = DEFAULT_FACE) {
    if (!isFace(pref)) pref = DEFAULT_FACE;
    if (pref === this.pref) return;
    this.pref = pref;
    this.show(pref === RANDOM_FACE ? pickRandomFace(this.face) : pref);
  }

  rollFace() { if (this.pref === RANDOM_FACE) this.show(pickRandomFace(this.face)); }

  // The texture is built in the background; the old one stays until the new one is ready
  show(style) {
    this.face = style;
    const tok = ++this._tok;
    ballTexture(style).then((map) => {
      if (map && tok === this._tok) applyFaceMaterial(this.mesh.material, style, map);
    });
  }

  // Ball size 1-5 (see BALL_SIZES). Takes effect immediately; a ball already on the ground is lifted onto it.
  setSize(size = 5) {
    const r = setBallSize(size);
    this.mesh.scale.setScalar(r / BALL_R);
    if (this.pos.y < r) this.pos.y = r;
    this.mesh.position.copy(this.pos);
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  reset(x = 0, z = 0) {
    this.pos.set(x, BALL.r, z);
    this.vel.set(0, 0, 0);
    this.owner = null;
    this.lastToucher = null;
    this.held = null;
    this.netSide = 0;
    this.spin = 0;
    this.mesh.position.copy(this.pos);
  }

  // spin: horizontal curl in rad/s (positive turns the flight path towards +z when moving along +x)
  kick(player, angle, speed, lift, spin = 0) {
    this.vel.set(Math.cos(angle) * speed, lift, Math.sin(angle) * speed);
    this.spin = spin;
    this.owner = player;
    this.lastToucher = player;
    this.held = null;
    this.onEvent('kick', speed);
  }

  step(dt) {
    if (this.held) {
      const p = this.held;
      let tx, ty, tz;
      if (p.carryOk) { tx = p.carry.x; ty = p.carry.y; tz = p.carry.z; }
      else { // first frame of a catch, before the hands have been posed
        const yaw = Math.PI / 2 - p.mesh.rotation.y;
        tx = p.pos.x + Math.cos(yaw) * 0.41; ty = 1.27; tz = p.pos.z + Math.sin(yaw) * 0.41;
      }
      // the first frames of a catch draw the ball into the hands; after that it is pinned between them
      if (this.heldFor !== p) { this.heldFor = p; this.heldN = 0; }
      const e = Math.min(1, 0.4 + 0.2 * this.heldN++);
      this.pos.x += (tx - this.pos.x) * e; this.pos.y += (ty - this.pos.y) * e; this.pos.z += (tz - this.pos.z) * e;
      this.vel.set(0, 0, 0);
      this.mesh.position.copy(this.pos);
      return;
    }
    this.heldFor = null;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.sub(h);
    this.mesh.position.copy(this.pos);

    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.05) {
      this._axis.set(this.vel.z, 0, -this.vel.x).normalize();
      this.mesh.rotateOnWorldAxis(this._axis, (sp * dt) / BALL.r);
    }
  }

  bounceXZ(cx, cz, rad) {
    const p = this.pos, v = this.vel;
    const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
    if (d >= rad || d < 1e-5) return;
    const nx = dx / d, nz = dz / d;
    p.x = cx + nx * rad; p.z = cz + nz * rad;
    const vn = v.x * nx + v.z * nz;
    if (vn < 0) { v.x -= 1.7 * vn * nx; v.z -= 1.7 * vn * nz; this.onEvent('post', -vn); }
  }

  bounceXY(cx, cy, rad) {
    const p = this.pos, v = this.vel;
    const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy);
    if (d >= rad || d < 1e-5) return;
    const nx = dx / d, ny = dy / d;
    p.x = cx + nx * rad; p.y = cy + ny * rad;
    const vn = v.x * nx + v.y * ny;
    if (vn < 0) { v.x -= 1.7 * vn * nx; v.y -= 1.7 * vn * ny; this.onEvent('bar', -vn); }
  }

  sub(h) {
    const R = BALL.r;
    const p = this.pos, v = this.vel;
    v.y -= GRAVITY * h;
    p.addScaledVector(v, h);
    const air = Math.exp(-0.08 * h);
    v.x *= air; v.z *= air;
    if (this.windAcc && p.y > R + 0.15) { v.x += this.windAcc.x * h; v.z += this.windAcc.z * h; } // wind only moves a ball in the air
    if (this.spin !== 0) {
      const aloft = p.y > R + 0.05;
      const a = this.spin * h, c = Math.cos(a), s = Math.sin(a);
      const vx = v.x * c - v.z * s;
      v.z = v.x * s + v.z * c;
      v.x = vx;
      this.spin *= Math.exp((aloft ? -0.35 : -9) * h);
      if (Math.abs(this.spin) < 0.02) this.spin = 0;
    }

    if (p.y < R) {
      p.y = R;
      if (v.y < -1.5) {
        this.onEvent('bounce', -v.y);
        v.y = -v.y * 0.6; v.x *= 0.97; v.z *= 0.97;
      } else v.y = 0;
    }
    if (p.y <= R + 0.02) {
      const f = Math.exp(-1.15 * this.roll * h);
      v.x *= f; v.z *= f;
    }
    if (p.y > 14 && v.y > 0) v.y *= -0.5;

    const sx = p.x < 0 ? -1 : 1;
    const gx = sx * PITCH.hl;
    if (Math.abs(p.x - gx) < R + 0.3) {
      if (p.y < GOAL.h + 0.3) {
        this.bounceXZ(gx, -GOAL.hw, R + 0.06);
        this.bounceXZ(gx, GOAL.hw, R + 0.06);
      }
      if (Math.abs(p.z) < GOAL.hw) this.bounceXY(gx, GOAL.h, R + 0.06);
    }

    const ax = Math.abs(p.x);
    if (this.netSide === 0) {
      const inMouth = Math.abs(p.z) < GOAL.hw - R * 0.3 && p.y < GOAL.h - R * 0.3;
      if (ax + R > PITCH.hl) {
        if (inMouth) {
          if (ax > PITCH.hl) this.netSide = sx;
        } else if (this.walls && ax < PITCH.hl + 0.6) {
          p.x = sx * (PITCH.hl - R);
          if (v.x * sx > 0) { v.x *= -0.65; this.onEvent('wall', Math.abs(v.x)); }
        }
      }
    } else {
      const s = this.netSide;
      const back = PITCH.hl + GOAL.d - R;
      if (p.x * s > back) { p.x = s * back; if (v.x * s > 0) v.x *= -0.2; v.z *= 0.7; }
      if (Math.abs(p.z) > GOAL.hw - R) { p.z = Math.sign(p.z) * (GOAL.hw - R); v.z *= -0.2; }
      if (p.y > GOAL.h - R) { p.y = GOAL.h - R; if (v.y > 0) v.y *= -0.2; }
      if (p.x * s < PITCH.hl - R * 0.5) this.netSide = 0;
    }

    if (this.walls) {
      if (Math.abs(p.z) > PITCH.hw - R) {
        const sz = Math.sign(p.z);
        p.z = sz * (PITCH.hw - R);
        if (v.z * sz > 0) { v.z *= -0.7; v.x *= 0.96; this.onEvent('wall', Math.abs(v.z)); }
      }
    } else if (this.netSide === 0) {
      // no boards: the ball may leave the pitch (the rules call it out at once); a far stop only keeps it from running away
      const far = PITCH.hw + 4;
      if (Math.abs(p.z) > far) { p.z = Math.sign(p.z) * far; v.z *= -0.2; }
      if (ax > PITCH.hl + 4) { p.x = sx * (PITCH.hl + 4); v.x *= -0.2; }
    }
  }
}
