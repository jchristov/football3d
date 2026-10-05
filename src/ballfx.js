import { VERTS, smooth, clamp01 } from './ballgeo.js';

// Anti-aliased line coverage: 1 on the line, 0 outside; x = distance to the line centre, w = half width (radians)
export const AA = 0.0035;
export const line = (x, w, aa = AA) => 1 - smooth((Math.abs(x) - w) / (2 * aa) + 0.5);
// Coverage of the inside of a signed distance field (negative inside)
export const fill = (sd, aa = AA) => 1 - smooth(sd / (2 * aa) + 0.5);

export const put = (o, r, g, b) => { o[0] = r; o[1] = g; o[2] = b; };
export const blend = (o, r, g, b, a) => { o[0] += (r - o[0]) * a; o[1] += (g - o[1]) * a; o[2] += (b - o[2]) * a; };
export const grey = (o, v) => { o[0] = v; o[1] = v; o[2] = v; };
// rgb arrays (0..1) -> mix
export const mixTo = (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; };
export const hex = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];

// Nearest pentagon centre (icosahedron vertex) and the tangent coordinates of the sample around it
const NV = { u: 0, v: 0, r: 0, th: 0, i: 0, c: null };
export function nearVert(S) {
  let best = -2, bi = 0;
  for (let i = 0; i < 12; i++) {
    const n = VERTS[i].n, d = S.dx * n[0] + S.dy * n[1] + S.dz * n[2];
    if (d > best) { best = d; bi = i; }
  }
  const V = VERTS[bi];
  NV.i = bi; NV.c = V;
  NV.u = S.dx * V.e1[0] + S.dy * V.e1[1] + S.dz * V.e1[2];
  NV.v = S.dx * V.e2[0] + S.dy * V.e2[1] + S.dz * V.e2[2];
  NV.r = Math.hypot(NV.u, NV.v);
  NV.th = Math.atan2(NV.v, NV.u);
  return NV;
}

export { clamp01, smooth };
