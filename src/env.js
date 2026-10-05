import * as THREE from 'three';

function skyTexture(top, mid, bottom) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const TIMES = {
  day: {
    sky: ['#3f86d6', '#8cc2ee', '#d3e8f6'], fog: 0xa9c9e6, hemi: [0xdcecff, 0x3d5a3a, 1.1],
    sun: [0xfff6e0, 3.0, [-18, 42, 20]], lamps: 0, exposure: 1.0, ground: 0x2a3140, crowdLight: 1,
  },
  dusk: {
    sky: ['#272b66', '#c4577a', '#f2a65a'], fog: 0x9a6070, hemi: [0xffc9a0, 0x2a2a3a, 0.75],
    sun: [0xffa860, 1.9, [-42, 15, 12]], lamps: 0.55, exposure: 1.05, ground: 0x1d2030, crowdLight: 1,
  },
  night: {
    sky: ['#01040d', '#091129', '#18224a'], fog: 0x0a1230, hemi: [0x6f86c0, 0x10201a, 0.4],
    sun: [0x9db4ff, 0.45, [-18, 42, 20]], lamps: 1, exposure: 1.1, ground: 0x10141f, crowdLight: 1,
  },
};

// Gameplay-relevant effects: grip = player acceleration, roll = ball rolling friction multiplier
export const WEATHERS = {
  clear: { grip: 1, roll: 1, label: 'Clear' },
  rain: { grip: 0.82, roll: 0.78, label: 'Rain' },
  snow: { grip: 0.72, roll: 1.45, label: 'Snow' },
  mud: { grip: 0.8, roll: 1.5, drain: 1.15, label: 'Mud' }, // heavy going: slower, tiring, the ball stops quickly
  wind: { grip: 1, roll: 1, wind: 3.4, label: 'Wind' }, // pushes a ball in the air (m/s²), see Ball
};

export class Environment {
  constructor(scene, world) {
    this.scene = scene;
    this.w = world;
    this.time = 'day';
    this.weather = 'clear';
    this.physics = WEATHERS.clear;
    this.particles = 1; // fraction of rain / snow particles drawn (graphics quality)
    this.shadows = true;
    this.rain = this.makeRain();
    this.snow = this.makeSnow();
    this.windAngle = 0; // before makeWind(): the streaks are laid out along it
    this.wind = this.makeWind();
    scene.add(this.rain.obj, this.snow.obj, this.wind.obj);
    this.set('day', 'clear');
  }

  makeRain() {
    const N = 3000;
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) this.seed(pos, i * 6, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb8c8dc, transparent: true, opacity: 0.4, depthWrite: false }));
    obj.frustumCulled = false; obj.visible = false;
    return { obj, pos, N };
  }

  makeSnow() {
    const N = 2500;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 120; pos[i * 3 + 1] = Math.random() * 30; pos[i * 3 + 2] = (Math.random() - 0.5) * 90; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const obj = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0.9, depthWrite: false }));
    obj.frustumCulled = false; obj.visible = false;
    return { obj, pos, N };
  }

  // streaks of dust and leaves that blow along the wind direction
  makeWind() {
    const N = 700, pos = new Float32Array(N * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xe6e0c8, transparent: true, opacity: 0.35, depthWrite: false }));
    obj.frustumCulled = false; obj.visible = false;
    const w = { obj, pos, N };
    for (let i = 0; i < N; i++) this.seedWind(w, i, true);
    return w;
  }

  seedWind(w, i, anywhere) {
    const a = Number.isFinite(this.windAngle) ? this.windAngle : 0;
    const dx = Math.cos(a), dz = Math.sin(a), o = i * 6;
    const x = (Math.random() - 0.5) * 130, z = (Math.random() - 0.5) * 100, y = 0.4 + Math.random() * 9;
    // new streaks enter from the upwind side
    const px = anywhere ? x : x - dx * 65, pz = anywhere ? z : z - dz * 50;
    w.pos[o] = px; w.pos[o + 1] = y; w.pos[o + 2] = pz;
    w.pos[o + 3] = px + dx * 1.6; w.pos[o + 4] = y; w.pos[o + 5] = pz + dz * 1.6;
  }

  seed(pos, o, anyHeight) {
    const x = (Math.random() - 0.5) * 120, z = (Math.random() - 0.5) * 90, y = anyHeight ? Math.random() * 30 : 30 + Math.random() * 4;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    pos[o + 3] = x - 0.12; pos[o + 4] = y + 1.3; pos[o + 5] = z - 0.05;
  }

  set(time, weather, windAngle = this.windAngle) {
    if (!Number.isFinite(windAngle)) windAngle = 0;
    this.time = time; this.weather = weather;
    if (windAngle !== this.windAngle) { this.windAngle = windAngle; for (let i = 0; i < this.wind.N; i++) this.seedWind(this.wind, i, true); }
    const T = TIMES[time], W = WEATHERS[weather], w = this.w, scene = this.scene;
    this.physics = W;
    const grey = new THREE.Color(0x58626f);
    const mixGrey = (hex, k) => new THREE.Color(hex).lerp(grey, k);
    const dull = weather === 'rain' ? 0.55 : weather === 'snow' ? 0.3 : weather === 'mud' ? 0.35 : weather === 'wind' ? 0.12 : 0;

    const sky = T.sky.map((c) => '#' + mixGrey(new THREE.Color(c).getHex(), dull).getHexString());
    scene.background?.dispose?.();
    scene.background = skyTexture(...sky);
    const fogCol = mixGrey(T.fog, dull);
    if (weather === 'snow') fogCol.lerp(new THREE.Color(time === 'night' ? 0x3a4560 : 0xd8dee8), 0.55);
    scene.fog.color.copy(fogCol);
    const fs = Math.max(1, Math.pow(w.pitchScale, 0.9)); // the camera sits further away on a bigger pitch
    scene.fog.near = (weather === 'rain' ? 45 : weather === 'snow' ? 55 : 90) * fs;
    scene.fog.far = (weather === 'rain' ? 140 : weather === 'snow' ? 150 : 200) * fs;

    w.hemi.color.setHex(T.hemi[0]); w.hemi.groundColor.setHex(T.hemi[1]);
    w.hemi.intensity = T.hemi[2] * (weather === 'clear' ? 1 : 0.9);
    w.sun.color.setHex(T.sun[0]);
    w.sun.intensity = T.sun[1] * (weather === 'rain' ? 0.5 : weather === 'snow' ? 0.8 : weather === 'mud' ? 0.7 : 1);
    w.sun.position.set(...T.sun[2]).multiplyScalar(Math.max(1, w.pitchScale));
    w.sun.castShadow = this.shadows && w.sun.intensity > 0.6;
    w.ground.material.color.setHex(T.ground).lerp(new THREE.Color(0xdfe6ee), weather === 'snow' ? 0.8 : 0);

    const lampOn = T.lamps > 0;
    w.lampMat.color.setHex(lampOn ? 0xfffbe0 : 0x70757f);
    for (const s of w.spots) s.intensity = T.lamps * (time === 'night' ? 2400 : 1300) * Math.max(1, w.pitchScale) ** 2;

    w.pitch.material.roughness = weather === 'rain' ? 0.6 : 0.95;
    w.setMud?.(weather === 'mud');
    w.snowSheet.material.opacity = weather === 'snow' ? 0.62 : 0;
    this.rain.obj.visible = weather === 'rain';
    this.snow.obj.visible = weather === 'snow';
    this.wind.obj.visible = weather === 'wind';
    this.exposure = T.exposure;
    this.setParticles(this.particles);
    this.onChange?.(this);
  }

  setParticles(f) {
    this.particles = f;
    this.rain.obj.geometry.setDrawRange(0, Math.floor(this.rain.N * f) * 2);
    this.wind.obj.geometry.setDrawRange(0, Math.floor(this.wind.N * f) * 2);
    this.snow.obj.geometry.setDrawRange(0, Math.floor(this.snow.N * f));
  }

  update(dt, camera) {
    if (this.weather === 'wind') {
      const w = this.wind, dx = Math.cos(this.windAngle), dz = Math.sin(this.windAngle), v = 16 * dt;
      for (let i = 0; i < w.N; i++) {
        const o = i * 6;
        w.pos[o] += dx * v; w.pos[o + 2] += dz * v; w.pos[o + 3] += dx * v; w.pos[o + 5] += dz * v;
        if (!(Math.abs(w.pos[o]) <= 70 && Math.abs(w.pos[o + 2]) <= 55 && Number.isFinite(w.pos[o + 3] + w.pos[o + 5]))) this.seedWind(w, i, false); // also repairs any NaN
      }
      w.obj.geometry.attributes.position.needsUpdate = true;
    }
    if (this.weather === 'rain') {
      const p = this.rain.pos, fall = 32 * dt;
      for (let i = 0; i < this.rain.N; i++) {
        const o = i * 6;
        p[o + 1] -= fall; p[o + 4] -= fall;
        p[o] -= 2.5 * dt; p[o + 3] -= 2.5 * dt;
        if (p[o + 1] < 0) this.seed(p, o, false);
      }
      this.rain.obj.geometry.attributes.position.needsUpdate = true;
    } else if (this.weather === 'snow') {
      const p = this.snow.pos, t = performance.now() / 1000;
      for (let i = 0; i < this.snow.N; i++) {
        const o = i * 3;
        p[o + 1] -= 2.6 * dt;
        p[o] += Math.sin(t * 0.8 + i) * 0.6 * dt;
        p[o + 2] += Math.cos(t * 0.6 + i * 1.3) * 0.5 * dt;
        if (p[o + 1] < 0) { p[o + 1] = 30; p[o] = (Math.random() - 0.5) * 120; p[o + 2] = (Math.random() - 0.5) * 90; }
      }
      this.snow.obj.geometry.attributes.position.needsUpdate = true;
    }
  }
}
