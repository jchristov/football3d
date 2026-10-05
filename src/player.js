import * as THREE from 'three';
import { PITCH, clamp, angleDiff } from './constants.js';
import { shirtTexture, backTexture, frontTexture } from './kit.js';
import { hairGeometry, beardGeometry } from './hair.js';
import { skinHex, hairHex, bootHex, defaultLook } from './appearance.js';
const BASE_SPEED = 6.4;
export const FATIGUE_MIN = 0.86; // speed factor of a completely drained player
const SPRINT_DRAIN = 0.26, SPRINT_REGEN = 0.12;
export const POSE_LEN = 15;
const [RIG_X, RIG_Y, RIG_Z, UP_X, HIP_L, KNEE_L, HIP_R, KNEE_R, SH_L, EL_L, SH_R, EL_R, AB_L, AB_R, HEAD_Y] = [...Array(POSE_LEN).keys()];

// A decal that hugs the torso capsule (radius 0.25, centre y 0.36, 0.34 long) between heights y0..y1, covering the
// angles centre ± half around the body (angle PI = the back, 0 = the chest). UV x runs left to right as seen from outside.
function torsoDecal(y0, y1, centre, half, segs = 28, rows = 16) {
  const R = 0.25, YC = 0.36, HALF_CYL = 0.17, LIFT = 0.006;
  const radius = (y) => {
    const d = Math.abs(y - YC) - HALF_CYL;
    return (d <= 0 ? R : Math.sqrt(Math.max(0, R * R - d * d))) + LIFT;
  };
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const y = y0 + ((y1 - y0) * j) / rows, r = radius(y);
    for (let i = 0; i <= segs; i++) {
      const th = centre - half + (2 * half * i) / segs;
      pos.push(Math.sin(th) * r, y, Math.cos(th) * r);
      uv.push(i / segs, j / rows);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < segs; i++) {
    const a = j * (segs + 1) + i, b = a + 1, c = a + segs + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Geometry is shared between all players
const G = {
  pelvis: new THREE.CylinderGeometry(0.245, 0.265, 0.26, 16),
  shortLeg: new THREE.CylinderGeometry(0.112, 0.118, 0.24, 10),
  thigh: new THREE.CylinderGeometry(0.095, 0.08, 0.46, 10),
  shin: new THREE.CylinderGeometry(0.078, 0.06, 0.44, 10),
  sockTop: new THREE.CylinderGeometry(0.081, 0.079, 0.07, 10),
  boot: new THREE.BoxGeometry(0.14, 0.09, 0.3),
  backDecal: torsoDecal(0.14, 0.73, Math.PI, 0.98),
  frontDecal: torsoDecal(0.40, 0.68, 0, 0.5, 14, 8),
  sole: new THREE.BoxGeometry(0.145, 0.025, 0.31),
  torso: new THREE.CapsuleGeometry(0.25, 0.34, 4, 16),
  neck: new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8),
  head: new THREE.SphereGeometry(0.17, 20, 16),
  cap: new THREE.SphereGeometry(0.182, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52),
  afro: new THREE.SphereGeometry(0.23, 14, 12),
  eye: new THREE.SphereGeometry(0.022, 8, 6),
  sleeve: new THREE.CylinderGeometry(0.075, 0.07, 0.19, 10),
  upperArm: new THREE.CylinderGeometry(0.058, 0.052, 0.3, 8),
  foreArm: new THREE.CylinderGeometry(0.05, 0.043, 0.28, 8),
  hand: new THREE.SphereGeometry(0.058, 10, 8),

};

const SOLE_MAT = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0x111111 });
const GLOVE_MAT = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });

const INJURED_SPEED = 0.6; // pace of a player who is playing on with an injury
export class Player {
  constructor(team, spec, index) {
    this.team = team;
    this.role = spec.role;
    this.isGK = spec.role === 'GK';
    this.index = index;
    this.home = { lx: spec.lx, lz: spec.lz };
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.speedMul = 1;
    this.injured = false; // limping: slower, no sprinting (set by the lineups)
    this.stamina = 1; // short-term sprint tank
    this.energy = 1; // long-term freshness: drains over the match, slows the player down
    this.kickCd = 0; this.touchCd = 0; this.lungeT = 0; this.lungeCd = 0; this.stunT = 0;
    this.kickAnim = 0; this.saveCd = 0; this.holdT = 0; this.stuckT = 0;
    this.jumpT = 0; this.headCd = 0; this.grip = 1; this.drainMul = 1; this.squadSlot = 0;
    this.diveT = 0; this.diveSide = 1; this.holding = false;
    this.carry = new THREE.Vector3(); this.carryOk = false; // where the ball sits while the keeper holds it
    this.lungeAngle = 0;
    this.decide = Math.random() * 0.3;
    this.charge = 0;
    this.celebrate = false;
    this.anim = Math.random() * 6;
    this.num = 0; this.name = ''; this.id = ''; this.captain = false; this.appearance = null;
    this.kit = null;
    this.look = null; // Vector3 the head tracks (the ball)
    this.pose = new Float32Array(POSE_LEN);
    this.target = new Float32Array(POSE_LEN);
    this.buildMesh();
  }

  buildMesh() {
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.75, ...o });
    const m = (this.mats = {
      shirt: std({}), sleeve: std({}), shorts: std({}), sock: std({}), trim: std({}),
      skin: std({ color: 0xd29a68, roughness: 0.6 }),
      hair: std({ color: 0x2e1d12, roughness: 0.85 }),
      stubble: std({ color: 0x2e1d12, roughness: 0.9, transparent: true, opacity: 0.5, depthWrite: false }),
      boot: std({ color: 0x15161a, roughness: 0.5 }),
      band: std({ color: 0xffd21e, roughness: 0.6 }),
      back: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      front: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    });

    const root = (this.mesh = new THREE.Group());
    const rig = (this.rig = new THREE.Group());
    root.add(rig);
    const add = (geo, mat, x, y, z, parent) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z);
      o.castShadow = true;
      parent.add(o);
      return o;
    };
    const group = (x, y, z, parent) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

    // hips carry the legs and the upper body
    const hips = this.hips = group(0, 0.98, 0, rig);
    add(G.pelvis, m.shorts, 0, -0.02, 0, hips);

    const leg = (x) => {
      const hip = group(x, 0, 0, hips);
      add(G.thigh, m.skin, 0, -0.23, 0, hip);
      add(G.shortLeg, m.shorts, 0, -0.1, 0, hip);
      const knee = group(0, -0.46, 0, hip);
      add(G.shin, m.sock, 0, -0.22, 0, knee);
      add(G.sockTop, m.trim, 0, -0.06, 0, knee);
      add(G.boot, m.boot, 0, -0.485, 0.07, knee);
      add(G.sole, SOLE_MAT, 0, -0.53, 0.07, knee);
      return { hip, knee };
    };
    const L = leg(-0.12), R = leg(0.12);
    this.hipL = L.hip; this.kneeL = L.knee; this.hipR = R.hip; this.kneeR = R.knee;

    const upper = this.upper = group(0, 0, 0, hips);
    const torso = add(G.torso, m.shirt, 0, 0.36, 0, upper);
    torso.scale.set(1.14, 1, 0.82);
    this.back = new THREE.Mesh(G.backDecal, m.back);
    this.front = new THREE.Mesh(G.frontDecal, m.front);
    for (const d of [this.back, this.front]) { d.scale.set(1.14, 1, 0.82); upper.add(d); }
    add(G.neck, m.skin, 0, 0.8, 0, upper);

    const head = this.head = group(0, 0.8, 0, upper);
    add(G.head, m.skin, 0, 0.16, 0, head).scale.y = 1.1;
    this.hairGroup = group(0, 0, 0, head); // hair, facial hair and headband live here and are swapped by setLook()
    add(G.eye, EYE_MAT, -0.06, 0.18, 0.155, head);
    add(G.eye, EYE_MAT, 0.06, 0.18, 0.155, head);

    const arm = (x) => {
      const sh = group(x, 0.66, 0, upper);
      add(G.upperArm, m.skin, 0, -0.15, 0, sh);
      add(G.sleeve, m.sleeve, 0, -0.1, 0, sh);
      const el = group(0, -0.3, 0, sh);
      const fore = add(G.foreArm, m.skin, 0, -0.14, 0, el);
      const longSleeve = add(G.foreArm, m.sleeve, 0, -0.14, 0, el);
      longSleeve.scale.set(1.12, 1, 1.12);
      longSleeve.visible = false;
      const hand = add(G.hand, m.skin, 0, -0.3, 0, el);
      return { sh, el, fore, longSleeve, hand };
    };
    const aL = arm(-0.34), aR = arm(0.34);
    this.shL = aL.sh; this.elL = aL.el; this.shR = aR.sh; this.elR = aR.el;
    this.armband = add(new THREE.CylinderGeometry(0.082, 0.082, 0.05, 12), m.band, 0, -0.13, 0, aL.sh);
    this.armband.castShadow = false;
    this.armband.visible = false;
    this.longSleeves = [aL.longSleeve, aR.longSleeve];
    this.hands = [aL.hand, aR.hand];
    this.setLook(defaultLook(0, 1));
  }

  // look: { skin (0..9, continuous), hair, style, beard, boots }
  setLook(look) {
    this.appearance = look;
    const m = this.mats;
    m.skin.color.setHex(skinHex(look.skin));
    m.hair.color.setHex(hairHex(look.hair));
    m.stubble.color.setHex(hairHex(look.hair));
    m.boot.color.setHex(bootHex(look.boots));
    const hg = this.hairGroup;
    while (hg.children.length) hg.remove(hg.children[0]);
    const put = (geo, mat, y = 0) => { if (!geo) return null; const o = new THREE.Mesh(geo, mat); o.castShadow = true; hg.add(o); return o; };
    const hair = hairGeometry(look.style);
    put(hair.hair, m.hair);
    put(hair.trim, m.band);
    const beard = beardGeometry(look.beard);
    put(beard.solid, m.hair);
    for (const o of hg.children) if (o.geometry === beard.stubble || o.geometry === beard.solid) { o.position.y = 0.16; o.scale.y = 1.1; if (o.geometry === beard.stubble) o.castShadow = false; }
  }

  setCaptain(on) { this.captain = !!on; this.armband.visible = this.captain; }

  // kit: { shirt, trim, pattern, shorts, sock }
  setKit(kit) {
    this.kit = kit;
    const m = this.mats;
    m.shirt.map = shirtTexture(kit.shirt, kit.trim, kit.pattern);
    m.shirt.color.set(0xffffff);
    m.shirt.needsUpdate = true;
    m.sleeve.color.set(kit.shirt);
    m.shorts.color.set(kit.shorts);
    m.sock.color.set(kit.sock);
    m.trim.color.set(kit.trim);
    m.band.color.set(kit.trim);
    for (const s of this.longSleeves) s.visible = this.isGK;
    for (const h of this.hands) h.material = this.isGK ? GLOVE_MAT : m.skin;
    this.refreshDecals();
  }

  // One squad member: shirt number and name, appearance and captaincy
  setIdentity(num, name, look, captain = false, id = '') {
    this.num = num; this.name = name; this.id = id;
    if (look) this.setLook(look);
    this.setCaptain(captain);
    this.refreshDecals();
  }

  refreshDecals() {
    if (!this.kit || !this.num) return;
    this.mats.back.map = backTexture(this.num, this.name, this.kit.shirt);
    this.mats.front.map = frontTexture(this.num, this.kit.shirt);
    this.mats.back.needsUpdate = true;
    this.mats.front.needsUpdate = true;
  }

  place(x, z, facing) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.kickCd = this.touchCd = this.lungeT = this.stunT = this.saveCd = this.holdT = this.kickAnim = this.stuckT = this.jumpT = this.headCd = this.diveT = 0;
    this.charge = 0;
    this.celebrate = false;
    this.stamina = 1;
  }

  // Catch your breath during dead balls
  rest(dt) {
    this.energy = Math.min(1, this.energy + 0.012 * dt);
    this.stamina = Math.min(1, this.stamina + 0.3 * dt);
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  tick(dt) {
    this.kickCd = Math.max(0, this.kickCd - dt);
    this.touchCd = Math.max(0, this.touchCd - dt);
    this.lungeT = Math.max(0, this.lungeT - dt);
    this.lungeCd = Math.max(0, this.lungeCd - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.saveCd = Math.max(0, this.saveCd - dt);
    this.kickAnim = Math.max(0, this.kickAnim - dt);
    this.jumpT = Math.max(0, this.jumpT - dt);
    this.headCd = Math.max(0, this.headCd - dt);
    this.diveT = Math.max(0, this.diveT - dt);
  }

  startLunge(angle = this.facing) {
    if (this.lungeCd > 0 || this.stunT > 0 || this.isGK) return false;
    this.lungeT = 0.45;
    this.lungeCd = 1.6;
    this.lungeAngle = angle;
    return true;
  }

  // dx,dz: desired direction (magnitude up to 1 scales speed)
  move(dx, dz, sprint, dt, mul = 1) {
    let len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; len = 1; }
    if (this.stunT > 0) { dx = dz = len = 0; }

    if (this.lungeT > 0) {
      const k = 9.5 * (0.3 + this.lungeT / 0.45);
      this.vel.x = Math.cos(this.lungeAngle) * k;
      this.vel.z = Math.sin(this.lungeAngle) * k;
      this.facing = this.lungeAngle;
    } else {
      const canSprint = sprint && !this.injured && this.stamina > 0.02 && len > 0.1;
      const tired = FATIGUE_MIN + (1 - FATIGUE_MIN) * this.energy;
      const max = BASE_SPEED * PITCH.speed * this.speedMul * mul * tired * (canSprint ? 1.32 : 1) * (this.injured ? INJURED_SPEED : 1);
      const tx = dx * max, tz = dz * max;
      const ex = tx - this.vel.x, ez = tz - this.vel.z;
      const e = Math.hypot(ex, ez);
      const a = (len > 0.1 ? 34 : 28) * this.grip * dt;
      if (e > a) { this.vel.x += (ex / e) * a; this.vel.z += (ez / e) * a; }
      else { this.vel.x = tx; this.vel.z = tz; }
      const regen = SPRINT_REGEN * (0.5 + 0.5 * this.energy);
      this.stamina = canSprint ? Math.max(0, this.stamina - SPRINT_DRAIN * dt) : Math.min(1, this.stamina + regen * dt);
      this.energy = Math.max(0, this.energy - (0.0012 + 0.0004 * this.speed + (canSprint ? 0.002 : 0)) * this.drainMul * (this.envDrain || 1) * dt);

      const sp = this.speed;
      if (sp > 0.8) {
        const target = Math.atan2(this.vel.z, this.vel.x);
        let d = target - this.facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.facing += d * (1 - Math.exp(-14 * dt));
      }
    }
    this.pos.x = clamp(this.pos.x + this.vel.x * dt, -PITCH.hl + 0.5, PITCH.hl - 0.5);
    this.pos.z = clamp(this.pos.z + this.vel.z * dt, -PITCH.hw + 0.5, PITCH.hw - 0.5);
  }

  moveTo(x, z, sprint, dt, mul = 1) {
    const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.25) { this.move(0, 0, false, dt); return d; }
    const s = Math.min(1, d / 1.5);
    this.move((dx / d) * s, (dz / d) * s, sprint && d > 3, dt, mul);
    return d;
  }

  faceToward(x, z, dt) {
    const target = Math.atan2(z - this.pos.z, x - this.pos.x);
    let d = Math.atan2(Math.sin(target - this.facing), Math.cos(target - this.facing));
    this.facing += d * (1 - Math.exp(-8 * dt));
  }

  // ---- animation ----
  computePose(t, time) {
    const sp = this.speed;
    this.anim += t.dt * (2.4 + sp * 0.9);
    const k = Math.min(sp / 6.5, 1.25);
    const s = Math.sin(this.anim), c = Math.cos(this.anim);
    const T = this.target;
    T.fill(0);
    const breathe = Math.sin(time * 2.2 + this.index) * 0.02;

    // locomotion / idle
    const run = k > 0.08;
    T[HIP_L] = s * 0.95 * k; T[HIP_R] = -s * 0.95 * k;
    T[KNEE_L] = (0.1 + 1.15 * Math.max(0, -c)) * k + 0.04;
    T[KNEE_R] = (0.1 + 1.15 * Math.max(0, c)) * k + 0.04;
    T[SH_L] = -s * 0.85 * k + 0.05 + breathe; T[SH_R] = s * 0.85 * k + 0.05 - breathe;
    T[EL_L] = -(0.25 + 0.85 * k); T[EL_R] = -(0.25 + 0.85 * k);
    T[AB_L] = 0.06; T[AB_R] = 0.06;
    T[UP_X] = Math.min(sp * 0.035, 0.32) + (run ? 0 : breathe);
    T[HEAD_Y] = 0;

    if (this.isGK && !this.holding && !this.celebrate) {
      // goalkeeper's ready stance
      T[UP_X] = 0.22; T[HIP_L] = T[HIP_R] = -0.28 * (1 - k); T[KNEE_L] = T[KNEE_R] = 0.5 * (1 - k) + T[KNEE_L] * k;
      T[SH_L] = T[SH_R] = -0.5; T[EL_L] = T[EL_R] = -0.8; T[AB_L] = T[AB_R] = 0.55;
    }
    // cradling the ball at chest height: both hands 0.41 m ahead and 0.26 m either side of the centre line
    if (this.holding) { T[SH_L] = T[SH_R] = -0.25; T[EL_L] = T[EL_R] = -1.2; T[AB_L] = T[AB_R] = -0.2; T[UP_X] = 0.12; }

    if (this.kickAnim > 0) {
      const u = 1 - this.kickAnim / 0.2;
      const swing = u < 0.5 ? u / 0.5 : 1;
      T[HIP_R] = 0.8 + (-1.35 - 0.8) * swing - (u > 0.5 ? (u - 0.5) * 0.5 : 0);
      T[KNEE_R] = 1.5 + (0.15 - 1.5) * swing;
      T[HIP_L] = 0.15; T[KNEE_L] = 0.25;
      T[UP_X] = -0.12; T[SH_L] = -0.4; T[SH_R] = 0.5; T[AB_L] = T[AB_R] = 0.7;
    }

    let rigX = 0, rigY = 0, rigZ = 0;
    if (this.lungeT > 0) {
      // slide tackle: lie back, legs reaching forward
      rigX = -1.15; rigY = 0.3;
      T[HIP_L] = -0.7; T[HIP_R] = -1.0; T[KNEE_L] = 0.4; T[KNEE_R] = 0.05;
      T[UP_X] = 0; T[SH_L] = 0.9; T[SH_R] = 0.9; T[AB_L] = T[AB_R] = 1.0; T[EL_L] = T[EL_R] = -0.3;
    } else if (this.stunT > 0) {
      rigX = -1.45; rigY = 0.14;
      T[HIP_L] = -0.5; T[HIP_R] = -0.2; T[KNEE_L] = 0.9; T[KNEE_R] = 0.5; T[AB_L] = T[AB_R] = 0.9; T[SH_L] = T[SH_R] = 0.3;
    } else if (this.celebrate) {
      rigY = Math.abs(Math.sin(time * 7 + this.index)) * 0.55;
      T[SH_L] = T[SH_R] = -2.9; T[AB_L] = T[AB_R] = 0.25; T[EL_L] = T[EL_R] = -0.2; T[UP_X] = -0.05;
      T[KNEE_L] = T[KNEE_R] = 0.3 + 0.4 * (1 - rigY);
    }
    if (this.diveT > 0) {
      const u = 1 - this.diveT / 0.6;
      const arc = Math.sin(Math.min(1, u * 1.15) * Math.PI);
      rigZ = -this.diveSide * (0.4 + 1.0 * Math.min(1, u * 2.2));
      rigY = 0.35 * arc;
      T[SH_L] = T[SH_R] = -2.8; T[AB_L] = T[AB_R] = 0.15; T[EL_L] = T[EL_R] = -0.1; T[UP_X] = 0.1;
      T[HIP_L] = 0.3; T[HIP_R] = -0.4; T[KNEE_L] = 0.4; T[KNEE_R] = 0.2;
    }
    if (this.jumpT > 0) {
      const u = 1 - this.jumpT / 0.5;
      rigY += Math.sin(u * Math.PI) * 0.65;
      T[UP_X] = -0.35; T[SH_L] = T[SH_R] = -0.8; T[AB_L] = T[AB_R] = 0.7;
      T[HIP_L] = 0.25; T[KNEE_L] = 0.9; T[HIP_R] = 0.1; T[KNEE_R] = 0.5;
    }
    T[RIG_X] = rigX; T[RIG_Y] = rigY; T[RIG_Z] = rigZ;

    if (this.look) {
      const want = Math.atan2(this.look.z - this.pos.z, this.look.x - this.pos.x);
      T[HEAD_Y] = clamp(angleDiff(this.facing, want), -1.0, 1.0) * 0.9;
    }
  }

  applyPose() {
    const p = this.pose;
    this.rig.rotation.set(p[RIG_X], 0, p[RIG_Z]);
    this.rig.position.y = p[RIG_Y];
    this.upper.rotation.x = p[UP_X];
    this.hipL.rotation.x = p[HIP_L]; this.kneeL.rotation.x = p[KNEE_L];
    this.hipR.rotation.x = p[HIP_R]; this.kneeR.rotation.x = p[KNEE_R];
    this.shL.rotation.set(p[SH_L], 0, -p[AB_L]); this.elL.rotation.x = p[EL_L];
    this.shR.rotation.set(p[SH_R], 0, p[AB_R]); this.elR.rotation.x = p[EL_R];
    this.head.rotation.y = p[HEAD_Y];
  }

  // The ball is carried between the two hands (so it stays in them in every pose, including a dive)
  updateCarry() {
    if (!this.holding) { this.carryOk = false; return; }
    this.mesh.updateMatrixWorld(true);
    const a = this.hands[0].getWorldPosition(this.carry), bx = a.x, by = a.y, bz = a.z;
    const b = this.hands[1].getWorldPosition(this._h2 || (this._h2 = new THREE.Vector3()));
    this.carry.set((bx + b.x) / 2, (by + b.y) / 2, (bz + b.z) / 2);
    this.carryOk = true;
  }

  getPose(out, off) { for (let i = 0; i < POSE_LEN; i++) out[off + i] = this.pose[i]; }
  setPose(arr, off) { for (let i = 0; i < POSE_LEN; i++) this.pose[i] = arr[off + i]; this.applyPose(); }

  syncMesh(dt, time) {
    this._t = this._t || {};
    this._t.dt = dt;
    this.computePose(this._t, time);
    const ease = Math.min(1, dt * 28), slow = Math.min(1, dt * 14);
    for (let i = 0; i < POSE_LEN; i++) {
      const r = i === RIG_X || i === RIG_Y || i === RIG_Z || i === UP_X ? slow : ease;
      this.pose[i] += (this.target[i] - this.pose[i]) * r;
    }
    this.applyPose();

    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.updateCarry();
    const dy = Math.PI / 2 - this.facing;
    const cur = this.mesh.rotation.y;
    const d = Math.atan2(Math.sin(dy - cur), Math.cos(dy - cur));
    this.mesh.rotation.y = cur + d * Math.min(1, dt * 16);
  }
}
