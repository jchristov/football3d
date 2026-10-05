import { smooth, mixf, sdTriangle, sdStar5 } from './ballgeo.js';
import { line, fill, put, blend, grey, mixTo, nearVert } from './ballfx.js';

// Shaders: (S, o) -> write linear-ish sRGB 0..1 into o. S = { dx,dy,dz (direction), c / c2 (nearest and second
// cell), edge (distance to the nearest panel edge), u,v,r,th (position inside cell c), sk (skin) }.

const BLACK = 0.055, WHITE = 0.97;

function classic(S, o) { // black pentagons, white hexagons with thin seams
  if (S.c.dark) return grey(o, BLACK);
  grey(o, mixf(WHITE, BLACK, S.c2.dark ? 0 : line(S.edge, 0.0095)));
}

function ink(S, o) { // black ball with white seams
  grey(o, mixf(BLACK, 0.96, line(S.edge, 0.026)));
}

function petals(S, o) { // rounded white panels floating on black
  const sk = S.sk;
  if (S.c.pent) return grey(o, BLACK);
  const { N, score, gap, cells } = sk, i1 = S.i1, b1 = score[i1];
  let sum = 0;
  for (let j = 0; j < N; j++) {
    if (j === i1) continue;
    const e = (b1 - score[j]) / gap[i1 * N + j] - (cells[j].pent ? 0.035 : 0);
    if (e < 0.3) sum += Math.exp(-22 * e);
  }
  const soft = -Math.log(sum || 1e-9) / 22;
  grey(o, mixf(BLACK, 0.98, smooth((soft - 0.026) / 0.008 + 0.5)));
}

const SILVER = [0.74, 0.76, 0.82];
function triad(S, o) { // white ball, black rounded triangle on every hexagon
  grey(o, WHITE);
  if (!S.c.pent) {
    const sd = sdTriangle(S.v, S.u, 0.325) - 0.045;
    blend(o, 0.05, 0.05, 0.06, fill(sd));
  }
  blend(o, 0.06, 0.06, 0.07, line(S.edge, 0.0055) * 0.9);
}

function stars(S, o) { // silver stars on the pentagons, white hexagons
  grey(o, 0.955);
  const t = S.dy * 0.5 + 0.5;
  o[0] -= 0.02 * t; o[2] += 0.015 * (1 - t);
  if (S.c.pent) {
    const sd = sdStar5(S.v, S.u, 0.35, 0.5);
    const hue = 0.5 + 0.5 * Math.sin(S.th * 5 + S.r * 14);
    mixTo(o, SILVER, [0.86, 0.82, 0.93], hue * smooth(S.r / 0.3));
    blend(o, 0.955, 0.955, 0.965, 1 - fill(sd));
    blend(o, 0.22, 0.2, 0.32, line(sd, 0.0065));
  }
  blend(o, 0.62, 0.62, 0.7, line(S.edge, 0.004) * 0.6);
}

function nightStars(S, o) { // white stars on deep violet panels
  const t = smooth(S.r / 0.4);
  put(o, 0.1 + 0.04 * t, 0.08 + 0.03 * t, 0.26 + 0.1 * t);
  const streak = 0.5 + 0.5 * Math.sin(S.th * 3 + S.r * 25);
  blend(o, 0.1, 0.7, 0.75, 0.07 * streak);
  if (S.c.pent) {
    const sd = sdStar5(S.v, S.u, 0.35, 0.5);
    blend(o, 0.97, 0.97, 0.99, fill(sd));
    blend(o, 0.3, 0.9, 0.95, line(sd - 0.012, 0.004) * 0.9);
  }
  blend(o, 0.02, 0.02, 0.05, line(S.edge, 0.007));
}

function burst(S, o) { // big blue spiky stars radiating from the pentagon centres
  grey(o, 0.95);
  blend(o, 0.6, 0.62, 0.7, line(S.edge, 0.004) * 0.6);
  const V = nearVert(S);
  const sd = sdStar5(V.v, V.u, 0.62, 0.3);
  const t = smooth(V.r / 0.6);
  const hatch = 0.5 + 0.5 * Math.sin(sd * 120);
  mixTo(o, [0.15, 0.4, 0.9], [0.55, 0.78, 1], t);
  o[0] += 0.07 * hatch * t; o[1] += 0.07 * hatch * t; o[2] += 0.05 * hatch * t;
  const cover = fill(sd);
  const base = [0.95, 0.95, 0.96];
  o[0] = base[0] + (o[0] - base[0]) * cover; o[1] = base[1] + (o[1] - base[1]) * cover; o[2] = base[2] + (o[2] - base[2]) * cover;
  blend(o, 0.35, 0.45, 0.6, line(sd, 0.005) * 0.7);
}

export const FACES_A = {
  classic: { label: 'Classic', cells: 'ico', shade: classic },
  hex: { label: 'Hex grid', cells: 'geo', shade: classic },
  ink: { label: 'Ink', cells: 'ico', shade: ink },
  petals: { label: 'Petals', cells: 'ico', shade: petals },
  triad: { label: 'Triad', cells: 'ico', shade: triad },
  stars: { label: 'Silver stars', cells: 'ico', shade: stars },
  nightstars: { label: 'Night stars', cells: 'ico', shade: nightStars },
  burst: { label: 'Burst', cells: 'ico', shade: burst },
};
