import { smooth, mixf, sdStar5, sdHexagon, fbm, hash, TAU } from './ballgeo.js';
import { line, fill, put, blend, grey, mixTo, hex, nearVert } from './ballfx.js';

// ---- spots: rounded hexagonal blobs of random size on a light panel ball
function spots(base, cols, accent) {
  return (S, o) => {
    put(o, base[0], base[1], base[2]);
    blend(o, 0.55, 0.55, 0.6, line(S.edge, 0.004) * 0.35);
    const c = S.c;
    if (c.pent) {
      const sd = sdStar5(S.v, S.u, 0.17, 0.5);
      blend(o, accent[0], accent[1], accent[2], fill(sd));
      return;
    }
    if (c.r3 < 0.12) return;
    const col = cols[Math.floor(c.r2 * cols.length) % cols.length];
    const cs = Math.cos(c.r1 * TAU), sn = Math.sin(c.r1 * TAU);
    const size = c.inr * (0.4 + 0.55 * c.r1);
    const sd = sdHexagon(S.u * cs - S.v * sn, S.u * sn + S.v * cs, size) - 0.025;
    blend(o, col[0], col[1], col[2], fill(sd));
    blend(o, accent[0], accent[1], accent[2], line(sd - 0.012, 0.0035) * 0.45);
  };
}

// ---- ribbons: big interlocking curved panels, like a modern match ball.
// Three-fold symmetric swirl: sample point is rotated about the axis through each of 6 anchor points by an
// angle that depends on its distance, then assigned to the nearest anchor.
const ANCHORS = (() => {
  const a = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  return a;
})();
function ribbons(cfg) {
  const A = cfg.anchors || ANCHORS;
  const N = A.length;
  const sc = new Float32Array(N);
  return (S, o) => {
    // swirl: rotate the sample around the Y axis in proportion to its height and around Z in proportion to X
    const t = cfg.twist;
    const ay = t * S.dy, c1 = Math.cos(ay), s1 = Math.sin(ay);
    let x = S.dx * c1 - S.dz * s1, z = S.dx * s1 + S.dz * c1, y = S.dy;
    const az = t * 0.8 * x, c2 = Math.cos(az), s2 = Math.sin(az);
    const y2 = y * c2 - z * s2, z2 = y * s2 + z * c2; y = y2; z = z2;
    const ax = t * 0.8 * y, c3 = Math.cos(ax), s3 = Math.sin(ax);
    const x3 = x * c3 - z * s3, z3 = x * s3 + z * c3; x = x3; z = z3;
    let b1 = -9, b2 = -9, i1 = 0;
    for (let i = 0; i < N; i++) {
      const d = x * A[i][0] + y * A[i][1] + z * A[i][2];
      sc[i] = d;
      if (d > b1) { b2 = b1; b1 = d; i1 = i; } else if (d > b2) b2 = d;
    }
    const edge = (b1 - b2) / 1.414;
    const col = cfg.cols[i1 % cfg.cols.length];
    if (cfg.noise) {
      const n = fbm(x * 3.1 + i1 * 5, y * 3.1, z * 3.1);
      mixTo(o, col, cfg.alt[i1 % cfg.alt.length], smooth((n - 0.35) / 0.3));
    } else put(o, col[0], col[1], col[2]);
    const wob = 0.01 * Math.sin(x * 16 + y * 9 + z * 12);
    for (const l of cfg.inner || []) blend(o, l.col[0], l.col[1], l.col[2], line(edge - l.at + wob, l.w) * (l.a ?? 1));
    for (const b of cfg.seams) blend(o, b.col[0], b.col[1], b.col[2], line(edge, b.w));
    blend(o, 0, 0, 0, line(S.edge, 0.0035) * (cfg.stitch ?? 0.1));
  };
}

// ---- crescents: orange ball with a dark crescent on every hexagon
function crescents(S, o) {
  const c = S.c;
  put(o, 1, 0.45, 0.06);
  const shade = 0.5 + 0.5 * Math.sin(S.th * 3 + c.r1 * 9);
  o[0] -= 0.04 * shade;
  if (c.pent) { put(o, 0.9, 0.36, 0.05); blend(o, 0.95, 0.95, 0.95, fill(sdStar5(S.v, S.u, 0.12, 0.5))); }
  else {
    const cs = Math.cos(c.r1 * TAU), sn = Math.sin(c.r1 * TAU);
    const x = S.u * cs - S.v * sn, y = S.u * sn + S.v * cs;
    const sd = Math.max(Math.hypot(x, y) - 0.165, -(Math.hypot(x - 0.075, y) - 0.14));
    blend(o, 0.09, 0.15, 0.24, fill(sd));
    blend(o, 0.95, 0.95, 0.95, line(sd - 0.02, 0.004) * 0.85);
  }
  blend(o, 0.62, 0.22, 0.02, line(S.edge, 0.0045) * 0.7);
}

// ---- halftone: orange dots that grow along the ball
const HT_AXIS = (() => { const v = [0.6, 0.5, 0.62]; const l = Math.hypot(...v); return v.map((x) => x / l); })();
function halftone(S, o) {
  grey(o, 0.96);
  const th = Math.acos(Math.max(-1, Math.min(1, S.dy))), ph = Math.atan2(S.dz, -S.dx);
  const sp = 0.07, row = Math.round(th / sp), thr = row * sp;
  const n = Math.max(1, Math.round((TAU * Math.sin(Math.max(thr, 0.0001))) / sp));
  const col = Math.round((ph * n) / TAU), phc = (col * TAU) / n;
  const dist = Math.hypot(th - thr, (ph - phc) * Math.sin(th));
  const g = smooth((S.dx * HT_AXIS[0] + S.dy * HT_AXIS[1] + S.dz * HT_AXIS[2] + 0.35) / 1.1);
  blend(o, 1, 0.34, 0.14, fill(dist - sp * 0.46 * Math.pow(g, 0.85)));
  blend(o, 0.6, 0.6, 0.62, line(S.edge, 0.004) * 0.4);
}

// ---- contour: gradient outline loops inside each panel
function contour(S, o) {
  grey(o, 0.97);
  const t = S.dy * 0.5 + 0.5;
  const c1 = [0.12 + 0.8 * t, 0.42 - 0.12 * t, 0.96 - 0.35 * t];
  if (S.c.pent) blend(o, c1[0], c1[1], c1[2], 0.3 + 0.2 * (1 - smooth(S.r / 0.28)));
  blend(o, 0.55, 0.57, 0.62, line(S.edge, 0.004) * 0.7);
  for (const at of [0.04, 0.08]) blend(o, c1[0], c1[1], c1[2], line(S.edge - at, 0.0065) * (at < 0.05 ? 1 : 0.75));
  blend(o, c1[0], c1[1], c1[2], line(S.edge, 0.005) * 0.8);
}

// ---- tricolor: navy streaks, red pentagons, white hexagons, thin gold seams
function tricolor(S, o) {
  const c = S.c;
  if (c.pent) put(o, 0.85, 0.1, 0.14);
  else if (c.dark) {
    put(o, 0.08, 0.14, 0.4);
    const streak = smooth(Math.sin(S.th * 3 + S.r * 55) * 0.5 + 0.5) * smooth(1 - S.r / 0.2);
    blend(o, 0.88, 0.14, 0.16, streak * 0.8);
  } else put(o, 0.97, 0.97, 0.98);
  blend(o, 0.86, 0.68, 0.24, line(S.edge, 0.005));
}

// ---- gold: glossy gold with darker seams
function gold(S, o) {
  const shade = fbm(S.dx * 6, S.dy * 6, S.dz * 6);
  put(o, 0.86 + 0.06 * shade, 0.64 + 0.06 * shade, 0.17);
  if (S.c.pent) blend(o, 0.7, 0.5, 0.1, 0.55);
  blend(o, 0.42, 0.28, 0.05, line(S.edge, 0.0075));
}

// ---- glow: bright green with dark leaf shapes (emissive, so it shines at night)
function glow(S, o) {
  const c = S.c;
  put(o, 0.4, 1, 0.34);
  blend(o, 0.7, 1, 0.5, 0.2 * (1 - smooth(S.r / 0.25)));
  if (!c.pent) {
    const cs = Math.cos(c.r1 * TAU), sn = Math.sin(c.r1 * TAU);
    const x = S.u * cs - S.v * sn, y = S.u * sn + S.v * cs;
    const sd = Math.max(Math.hypot(x, y - 0.085) - 0.155, Math.hypot(x, y + 0.085) - 0.155);
    blend(o, 0.03, 0.22, 0.27, fill(sd));
    blend(o, 0.1, 0.5, 0.45, line(sd - 0.015, 0.003) * 0.7);
  } else blend(o, 0.03, 0.22, 0.27, 0.8);
  blend(o, 0.05, 0.3, 0.2, line(S.edge, 0.0045) * 0.8);
}

// ---- sunrise: yellow-orange-magenta gradient with dark shards at the pentagons
function sunrise(S, o) {
  const t = smooth(S.dy * 0.5 + 0.5 + 0.12 * Math.sin(S.dx * 3));
  if (t < 0.5) mixTo(o, [0.98, 0.15, 0.5], [1, 0.52, 0.06], smooth(t * 2));
  else mixTo(o, [1, 0.52, 0.06], [1, 0.92, 0.12], smooth((t - 0.5) * 2));
  const V = nearVert(S);
  blend(o, 0.22, 0.08, 0.3, fill(sdStar5(V.v, V.u, 0.36, 0.34)) * 0.88);
  blend(o, 0.22, 0.08, 0.3, line(S.edge, 0.007));
  blend(o, 0.22, 0.08, 0.3, line(S.edge - 0.05, 0.0035) * 0.5);
}

const W = [0.97, 0.97, 0.97];
const tri = {
  cols: [W, W, [0.86, 0.1, 0.14], [0.1, 0.36, 0.88], [0.1, 0.72, 0.38], W],
  twist: 1.5, seams: [{ at: 0, w: 0.016, col: [1, 1, 1] }, { at: 0, w: 0.006, col: [0.1, 0.1, 0.14] }],
  inner: [{ at: 0.055, w: 0.004, col: [1, 1, 1], a: 0.85 }],
};
const neon = {
  cols: [[0.78, 1, 0.1], [0.78, 1, 0.1], [0.34, 0.36, 0.4], [0.34, 0.36, 0.4], [0.78, 1, 0.1], [0.34, 0.36, 0.4]],
  twist: 1.9, seams: [{ w: 0.012, col: [0.06, 0.06, 0.08] }],
  inner: [{ at: 0.04, w: 0.004, col: [0.06, 0.06, 0.08], a: 0.9 }, { at: 0.075, w: 0.003, col: [0.95, 0.4, 0.1], a: 0.9 }],
};
const ocean = {
  cols: [[0.04, 0.07, 0.25], [0.04, 0.07, 0.25], [0.2, 0.72, 0.88], [0.2, 0.72, 0.88], [0.04, 0.07, 0.25], [0.2, 0.72, 0.88]],
  twist: 1.3, seams: [{ w: 0.012, col: [0.85, 0.9, 0.95] }],
  inner: [{ at: 0.05, w: 0.0035, col: [0.85, 0.9, 0.95], a: 0.8 }],
};
const ember = {
  cols: [[0.96, 0.93, 0.84], [0.96, 0.93, 0.84], [0.85, 0.26, 0.14], [0.85, 0.26, 0.14], [0.96, 0.93, 0.84], [0.85, 0.26, 0.14]],
  alt: [[0.9, 0.85, 0.72], [0.9, 0.85, 0.72], [0.45, 0.1, 0.08], [0.45, 0.1, 0.08], [0.9, 0.85, 0.72], [0.45, 0.1, 0.08]],
  noise: true, twist: 1.5, seams: [{ w: 0.01, col: [0.96, 0.93, 0.84] }, { w: 0.004, col: [0.55, 0.2, 0.1] }], inner: [],
};

export const FACES_B = {
  spots: { label: 'Spots', cells: 'geo', shade: spots(hex(0xf7f7f4), [hex(0x0e0e12), hex(0x0e0e12), hex(0x2a2b30)], hex(0xcfa24a)) },
  citrus: { label: 'Citrus spots', cells: 'geo', shade: spots(hex(0xffe14d), [hex(0x7a3fd0), hex(0xf4739f)], hex(0xff7f5a)) },
  ribbons: { label: 'Ribbons', cells: 'ico', shade: ribbons(tri) },
  neon: { label: 'Neon ribbons', cells: 'ico', shade: ribbons(neon) },
  ocean: { label: 'Ocean ribbons', cells: 'ico', shade: ribbons(ocean) },
  ember: { label: 'Ember', cells: 'ico', shade: ribbons(ember) },
  crescent: { label: 'Crescent', cells: 'geo', shade: crescents },
  halftone: { label: 'Halftone', cells: 'ico', shade: halftone },
  contour: { label: 'Contour', cells: 'ico', shade: contour },
  tricolor: { label: 'Tricolor', cells: 'geo', shade: tricolor },
  gold: { label: 'Gold', cells: 'ico', shade: gold, mat: { roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12 } },
  glow: { label: 'Glow', cells: 'geo', shade: glow, mat: { roughness: 0.5, glow: 0.65 } },
  sunrise: { label: 'Sunrise', cells: 'ico', shade: sunrise },
};
void mixf; void hash;
