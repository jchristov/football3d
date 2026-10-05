import test from 'node:test';
import assert from 'node:assert/strict';
import { BALL_FACES, RANDOM_FACE, DEFAULT_FACE, faceKeys, isFace, pickRandomFace, sampleFace, faceMaterial } from '../src/ballskin.js';
import { cellLayout } from '../src/ballgeo.js';
import { seedRandom } from './helpers.js';

// A spread of directions over the whole sphere, including both poles and the texture seam
const dirs = (() => {
  const out = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [-1, 0, 1e-6]];
  const n = 120, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), t = i * golden; out.push([Math.cos(t) * r, y, Math.sin(t) * r]); }
  return out;
})();

test('there are 21 faces, the default exists, and "random" is a valid choice but not a face', () => {
  assert.equal(faceKeys().length, 21);
  assert.ok(BALL_FACES[DEFAULT_FACE]);
  assert.ok(isFace(RANDOM_FACE) && !BALL_FACES[RANDOM_FACE]);
  assert.ok(!isFace('nope'));
  for (const f of Object.values(BALL_FACES)) { assert.ok(f.label); assert.ok(['ico', 'geo'].includes(f.cells)); assert.equal(typeof f.shade, 'function'); }
});

test('the cell layouts have the right panel counts (12+20 and 12+80)', () => {
  const ico = cellLayout('ico'), geo = cellLayout('geo');
  assert.equal(ico.length, 32); assert.equal(ico.filter((c) => c.pent).length, 12);
  assert.equal(geo.length, 92); assert.equal(geo.filter((c) => c.pent).length, 12);
  for (const c of [...ico, ...geo]) { assert.ok(Math.abs(Math.hypot(...c.n) - 1) < 1e-9); assert.ok(Math.abs(Math.hypot(...c.e1) - 1) < 1e-6); }
});

test('every face returns finite, in-range colours everywhere on the sphere', () => {
  for (const key of faceKeys()) for (const d of dirs) {
    const c = sampleFace(key, ...d);
    assert.equal(c.length, 3, key);
    for (const v of c) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${key} at ${d}: ${c}`);
  }
});

test('faces are distinct designs, not copies of each other', () => {
  const sig = (key) => dirs.slice(0, 60).map((d) => sampleFace(key, ...d).join(',')).join(';');
  const sigs = faceKeys().map(sig);
  assert.equal(new Set(sigs).size, sigs.length);
});

test('the classic face is a proper football: black pentagons, white hexagons', () => {
  const ico = cellLayout('ico');
  for (const c of ico) {
    const [r, g, b] = sampleFace('classic', ...c.n);
    if (c.pent) assert.ok(r < 40 && g < 40 && b < 40, 'pentagon centre is black');
    else assert.ok(r > 220 && g > 220 && b > 220, 'hexagon centre is white');
  }
});

test('patterns have no break at the texture seam', () => {
  for (const key of faceKeys()) {
    const a = sampleFace(key, -1, 0.3, 1e-4), b = sampleFace(key, -1, 0.3, -1e-4);
    const diff = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    assert.ok(diff < 60, `${key}: seam jump ${diff}`);
  }
});

test('random picks a real face and never repeats the previous one', () => {
  seedRandom(3);
  let prev = null; const seen = new Set();
  for (let i = 0; i < 300; i++) { const f = pickRandomFace(prev); assert.ok(BALL_FACES[f]); assert.notEqual(f, prev); seen.add(f); prev = f; }
  assert.equal(seen.size, 21, 'every face comes up eventually');
});

test('special materials: gold is glossy, glow is emissive, others are plain', () => {
  assert.equal(faceMaterial('gold').clearcoat, 1);
  assert.ok(faceMaterial('glow').glow > 0);
  assert.equal(faceMaterial('classic').glow, 0);
  assert.equal(faceMaterial('classic').clearcoat, 0);
});
