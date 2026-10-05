// Geometry and maths helpers for procedural ball faces.
// A "cell" is the region of the sphere seen through one flat panel of a polyhedral ball. Two layouts:
//  - ico: truncated icosahedron (12 pentagons + 20 hexagons), the classic football
//  - geo: 92 cells (12 pentagons + 80 hexagons), the icosahedron subdivided three times
export const TAU = Math.PI * 2;
const PHI = (1 + Math.sqrt(5)) / 2;

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
export const mixf = (a, b, t) => a + (b - a) * t;
export const hash = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const ICO_VERTS = (() => {
  const V = [];
  for (const a of [-1, 1]) for (const b of [-PHI, PHI]) V.push([0, a, b], [a, b, 0], [b, 0, a]);
  return V.map(unit);
})();

const EDGE = Math.min(...ICO_VERTS.slice(1).map((p) => dist(ICO_VERTS[0], p)));
const adjacent = (a, b) => Math.abs(dist(ICO_VERTS[a], ICO_VERTS[b]) - EDGE) < 1e-4;

export const ICO_FACES = (() => {
  const f = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) if (adjacent(i, j) && adjacent(j, k) && adjacent(i, k)) f.push([i, j, k]);
  return f;
})();

// Orthonormal tangent basis at n; e1 is rotated to point at `ref` (or by a random angle when ref is null)
function tangentBasis(n, ref, randomAngle) {
  let t = cross(n, [0.31, 0.71, 0.23]);
  if (Math.hypot(t[0], t[1], t[2]) < 1e-3) t = cross(n, [1, 0, 0]);
  const e1 = unit(t), e2 = cross(n, e1);
  const rot = ref ? Math.atan2(dot(ref, e2), dot(ref, e1)) : randomAngle;
  const c = Math.cos(rot), s = Math.sin(rot);
  return {
    e1: [c * e1[0] + s * e2[0], c * e1[1] + s * e2[1], c * e1[2] + s * e2[2]],
    e2: [-s * e1[0] + c * e2[0], -s * e1[1] + c * e2[1], -s * e1[2] + c * e2[2]],
    rot,
  };
}

function finish(cell, idx, ref) {
  Object.assign(cell, tangentBasis(cell.n, ref, hash(idx, 9) * TAU));
  cell.idx = idx;
  cell.r1 = hash(idx, 1); cell.r2 = hash(idx, 2); cell.r3 = hash(idx, 3);
  return cell;
}

// Truncated icosahedron. Cell i occupies the directions where dot(d, w_i) is largest.
function icoCells() {
  const hP = Math.sqrt(2.478 ** 2 - 0.8507 ** 2), hH = Math.sqrt(2.478 ** 2 - 1);
  const cells = [];
  ICO_VERTS.forEach((n, i) => {
    const face = ICO_FACES.find((f) => f.includes(i));
    const fc = unit([0, 1, 2].map((x) => ICO_VERTS[face[0]][x] + ICO_VERTS[face[1]][x] + ICO_VERTS[face[2]][x]));
    cells.push(finish({ n, w: n.map((x) => x / hP), pent: true, dark: true, inr: 0.287 }, cells.length, fc));
  });
  for (const f of ICO_FACES) {
    const n = unit([0, 1, 2].map((x) => ICO_VERTS[f[0]][x] + ICO_VERTS[f[1]][x] + ICO_VERTS[f[2]][x]));
    cells.push(finish({ n, w: n.map((x) => x / hH), pent: false, dark: false, inr: 0.365 }, cells.length, ICO_VERTS[f[0]]));
  }
  return cells;
}

// Icosphere frequency 3. "dark" cells (pentagons + the 20 face-centre hexagons) 3-colour the hexagon lattice.
function geoCells() {
  const raw = [];
  const push = (p, dark, pent) => {
    const n = unit(p);
    if (!raw.some((o) => dot(o.n, n) > 0.9999)) raw.push({ n, w: n, pent, dark: dark || pent, inr: pent ? 0.2 : 0.18 });
  };
  for (const v of ICO_VERTS) push(v, true, true);
  for (const [a, b, c] of ICO_FACES) {
    for (let i = 0; i <= 3; i++) for (let j = 0; i + j <= 3; j++) {
      const k = 3 - i - j;
      if (i === 3 || j === 3 || k === 3) continue;
      push([0, 1, 2].map((x) => (i * ICO_VERTS[a][x] + j * ICO_VERTS[b][x] + k * ICO_VERTS[c][x]) / 3), i === 1 && j === 1 && k === 1, false);
    }
  }
  return raw.map((cell, i) => {
    let ref = null;
    if (cell.pent) {
      let best = -2;
      for (const o of raw) if (o !== cell) { const d = dot(o.n, cell.n); if (d > best) { best = d; ref = o.n; } }
    }
    return finish(cell, i, ref);
  });
}

const layoutCache = {};
export function cellLayout(kind) { return (layoutCache[kind] ||= kind === 'ico' ? icoCells() : geoCells()); }

// The 12 pentagon centres with a tangent basis whose e1 points at a neighbouring vertex
export const VERTS = ICO_VERTS.map((n, i) => {
  const nb = ICO_VERTS.find((_, j) => j !== i && adjacent(i, j));
  return { n, ...tangentBasis(n, nb, 0) };
});

// ---- 2D signed distance functions (negative inside); coordinates are tangent-plane offsets (~radians)
export function sdTriangle(px, py, r) { // equilateral, apex towards +y, side 2r
  const k = Math.sqrt(3);
  px = Math.abs(px) - r; py += r / k;
  if (px + k * py > 0) { const x = px, y = py; px = (x - k * y) / 2; py = (-k * x - y) / 2; }
  px -= Math.max(-2 * r, Math.min(0, px));
  return -Math.hypot(px, py) * Math.sign(py);
}

const K1X = 0.809016994375, K1Y = -0.587785252292;
export function sdStar5(px, py, r, rf) { // tip towards +y, outer radius r, rf in (0..2): lower = spikier
  px = Math.abs(px);
  let m = 2 * Math.max(K1X * px + K1Y * py, 0); px -= m * K1X; py -= m * K1Y;
  m = 2 * Math.max(-K1X * px + K1Y * py, 0); px += m * K1X; py -= m * K1Y;
  px = Math.abs(px); py -= r;
  const bax = -rf * K1Y, bay = rf * K1X - 1;
  const h = Math.max(0, Math.min(r, (px * bax + py * bay) / (bax * bax + bay * bay)));
  return Math.hypot(px - bax * h, py - bay * h) * Math.sign(py * bax - px * bay);
}

export function sdHexagon(px, py, r) { // r = inradius
  px = Math.abs(px); py = Math.abs(py);
  const m = 2 * Math.min(-0.866025404 * px + 0.5 * py, 0);
  px += m * 0.866025404; py -= m * 0.5;
  px -= Math.max(-0.577350269 * r, Math.min(0.577350269 * r, px)); py -= r;
  return Math.hypot(px, py) * Math.sign(py);
}

// ---- value noise
const h3 = (x, y, z) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
export function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = smooth(x - xi), fy = smooth(y - yi), fz = smooth(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h3(xi, yi, zi), h3(xi + 1, yi, zi), fx), l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), fx), fy),
    l(l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), fx), l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), fx), fy),
    fz,
  );
}
export function fbm(x, y, z) { return vnoise(x, y, z) * 0.55 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.15; }
