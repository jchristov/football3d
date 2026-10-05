import * as THREE from 'three';
import { cellLayout } from './ballgeo.js';
import { FACES_A } from './ballfaces.js';
import { FACES_B } from './ballfaces2.js';

// Selectable ball faces. Every face is generated per texel from the direction on the sphere, so patterns have
// no stretching at the poles and no break at the texture seam. All designs are original and procedural.
export const BALL_FACES = { ...FACES_A, ...FACES_B };
export const DEFAULT_FACE = 'classic';
export const RANDOM_FACE = 'random';
export const faceKeys = () => Object.keys(BALL_FACES);
export const isFace = (k) => k === RANDOM_FACE || Object.prototype.hasOwnProperty.call(BALL_FACES, k);

// A random face, different from `not` when possible
export function pickRandomFace(not) {
  const keys = faceKeys().filter((k) => k !== not);
  return keys[Math.floor(Math.random() * keys.length)];
}

export const faceMaterial = (style) => ({ roughness: 0.45, clearcoat: 0, clearcoatRoughness: 0.3, glow: 0, ...(BALL_FACES[style]?.mat || {}) });

class Skin {
  constructor(style) {
    this.style = style;
    this.face = BALL_FACES[style];
    const cells = (this.cells = cellLayout(this.face.cells));
    const N = (this.N = cells.length);
    this.wx = Float32Array.from(cells, (c) => c.w[0]);
    this.wy = Float32Array.from(cells, (c) => c.w[1]);
    this.wz = Float32Array.from(cells, (c) => c.w[2]);
    this.score = new Float32Array(N);
    this.gap = new Float32Array(N * N); // |w_i - w_j| turns a score difference into a distance to the panel edge
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      this.gap[i * N + j] = Math.hypot(this.wx[i] - this.wx[j], this.wy[i] - this.wy[j], this.wz[i] - this.wz[j]) || 1;
    }
    this.S = { dx: 0, dy: 0, dz: 0, i1: 0, c: null, c2: null, edge: 0, u: 0, v: 0, r: 0, th: 0, sk: this };
  }

  // Writes the colour (0..1 sRGB) for direction d into out
  sample(dx, dy, dz, out) {
    const { N, wx, wy, wz, score, gap, cells, S } = this;
    let b1 = -9, b2 = -9, i1 = 0, i2 = 0;
    for (let i = 0; i < N; i++) {
      const s = dx * wx[i] + dy * wy[i] + dz * wz[i];
      score[i] = s;
      if (s > b1) { b2 = b1; i2 = i1; b1 = s; i1 = i; } else if (s > b2) { b2 = s; i2 = i; }
    }
    const c = cells[i1];
    S.dx = dx; S.dy = dy; S.dz = dz; S.i1 = i1; S.c = c; S.c2 = cells[i2];
    S.edge = (b1 - b2) / gap[i1 * N + i2];
    S.u = dx * c.e1[0] + dy * c.e1[1] + dz * c.e1[2];
    S.v = dx * c.e2[0] + dy * c.e2[1] + dz * c.e2[2];
    S.r = Math.hypot(S.u, S.v);
    S.th = Math.atan2(S.v, S.u);
    this.face.shade(S, out);
    return out;
  }
}

const skins = {};
const skin = (style) => (skins[style] ||= new Skin(style));

// Colour of a face in a direction as [r, g, b] 0..255 (also used by the tests)
export function sampleFace(style, dx, dy, dz) {
  if (!BALL_FACES[style]) style = DEFAULT_FACE;
  const l = Math.hypot(dx, dy, dz) || 1;
  const o = skin(style).sample(dx / l, dy / l, dz / l, [0, 0, 0]);
  return o.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
}

// ---------- textures (generated in small slices so switching faces never freezes the game) ----------
const MAX_CACHED = 4;
const textures = new Map();
const pending = new Map();

export function ballTexture(style, W = 1280, H = 640) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (!BALL_FACES[style]) style = DEFAULT_FACE;
  if (textures.has(style)) return Promise.resolve(textures.get(style));
  if (pending.has(style)) return pending.get(style);

  const p = new Promise((resolve) => {
    const sk = skin(style);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const img = g.createImageData(W, H);
    const px = new Float32Array(W), pz = new Float32Array(W), sinT = new Float32Array(H), cosT = new Float32Array(H);
    for (let x = 0; x < W; x++) { const phi = ((x + 0.5) / W) * Math.PI * 2; px[x] = -Math.cos(phi); pz[x] = Math.sin(phi); } // THREE.SphereGeometry layout
    for (let y = 0; y < H; y++) { const t = ((y + 0.5) / H) * Math.PI; sinT[y] = Math.sin(t); cosT[y] = Math.cos(t); }
    const out = [0, 0, 0];
    let y = 0;
    const work = () => {
      const t0 = performance.now();
      while (y < H && performance.now() - t0 < 8) {
        for (let x = 0; x < W; x++) {
          sk.sample(px[x] * sinT[y], cosT[y], pz[x] * sinT[y], out);
          const o = (y * W + x) * 4;
          img.data[o] = out[0] * 255; img.data[o + 1] = out[1] * 255; img.data[o + 2] = out[2] * 255; img.data[o + 3] = 255;
        }
        y++;
      }
      if (y < H) { setTimeout(work, 0); return; }
      g.putImageData(img, 0, 0);
      const map = new THREE.CanvasTexture(cv);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      textures.set(style, map);
      pending.delete(style);
      while (textures.size > MAX_CACHED) { // free the oldest face we are not looking at
        const [k, t] = textures.entries().next().value;
        if (k === style) break;
        t.dispose(); textures.delete(k);
      }
      resolve(map);
    };
    work();
  });
  pending.set(style, p);
  return p;
}

// Give a physical material the look of a face (texture + gloss / glow settings)
export function applyFaceMaterial(mat, style, map) {
  const m = faceMaterial(style);
  mat.map = map;
  mat.roughness = m.roughness;
  mat.clearcoat = m.clearcoat;
  mat.clearcoatRoughness = m.clearcoatRoughness;
  mat.emissiveMap = m.glow > 0 ? map : null;
  mat.emissive.setScalar(m.glow > 0 ? 1 : 0);
  mat.emissiveIntensity = m.glow;
  mat.needsUpdate = true;
}

// ---------- preview pictures for the pickers ----------
const previews = {};
export function ballPreview(style, size = 96) {
  if (typeof document === 'undefined' || !BALL_FACES[style]) return '';
  const key = `${style}-${size}`;
  if (previews[key]) return previews[key];
  const sk = skin(style);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  // turn a pentagon towards the viewer, like in a product picture
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, (1 + Math.sqrt(5)) / 2).normalize(), new THREE.Vector3(0, 0, 1));
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.31));
  q.invert();
  const v = new THREE.Vector3(), L = new THREE.Vector3(-0.45, 0.6, 0.66).normalize(), out = [0, 0, 0];
  const glow = faceMaterial(style).glow;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = ((x + 0.5) / size) * 2 - 1, ny = 1 - ((y + 0.5) / size) * 2, r2 = nx * nx + ny * ny, o = (y * size + x) * 4;
    if (r2 > 1) { img.data[o + 3] = 0; continue; }
    const nz = Math.sqrt(1 - r2);
    v.set(nx, ny, nz).applyQuaternion(q);
    sk.sample(v.x, v.y, v.z, out);
    const light = Math.max(0.5 + 0.55 * Math.max(0, nx * L.x + ny * L.y + nz * L.z) - 0.18 * (1 - nz), glow);
    for (let k = 0; k < 3; k++) img.data[o + k] = Math.min(255, out[k] * 255 * light + 4);
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return (previews[key] = cv.toDataURL());
}
