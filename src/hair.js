import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Hair and facial hair shapes, built once and shared by every player (positions are relative to the head
// group; the head sphere has radius 0.17, is centred at y 0.16 and is 1.1x taller than wide).
const M = new THREE.Matrix4(), V = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler();

function part(geo, pos, scale = [1, 1, 1], rot = [0, 0, 0]) {
  const g = geo.clone();
  M.compose(V.set(...pos), Q.setFromEuler(E.set(...rot)), S.set(...scale));
  g.applyMatrix4(M);
  return g;
}

const cap = (r, theta) => new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, theta);
const ball = (r) => new THREE.SphereGeometry(r, 9, 7);
const tube = (r, len) => new THREE.CylinderGeometry(r, r * 0.8, len, 6);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const PI = Math.PI;

const BUILD = {
  bald: () => ({ hair: null }),
  buzz: () => ({ hair: part(cap(0.176, 0.44 * PI), [0, 0.185, -0.012], [1, 1, 1], [-0.12, 0, 0]) }),
  short: () => ({ hair: part(cap(0.184, 0.48 * PI), [0, 0.185, -0.02], [1, 1, 1], [-0.18, 0, 0]) }),
  side: () => ({ hair: mergeGeometries([part(cap(0.184, 0.48 * PI), [0, 0.185, -0.02], [1, 1, 1], [-0.18, 0, 0]), part(ball(0.082), [0.035, 0.335, 0.075], [1.5, 0.65, 1.3], [0, 0, -0.25])]) }),
  curly: () => {
    const parts = [part(cap(0.182, 0.5 * PI), [0, 0.17, -0.012])];
    for (let k = 0; k < 12; k++) { const a = (k / 12) * PI * 2; parts.push(part(ball(0.06), [Math.sin(a) * 0.135, 0.27, Math.cos(a) * 0.135 - 0.01])); }
    for (let k = 0; k < 5; k++) { const a = (k / 5) * PI * 2; parts.push(part(ball(0.058), [Math.sin(a) * 0.06, 0.355, Math.cos(a) * 0.06 - 0.01])); }
    return { hair: mergeGeometries(parts) };
  },
  afro: () => ({ hair: part(ball(0.235), [0, 0.27, -0.07], [1, 0.95, 1]) }),
  long: () => ({ hair: mergeGeometries([part(cap(0.186, 0.5 * PI), [0, 0.185, -0.024], [1, 1, 1], [-0.18, 0, 0]), part(ball(0.17), [0, 0.03, -0.12], [1.05, 1.3, 0.62])]) }),
  ponytail: () => ({ hair: mergeGeometries([
    part(cap(0.184, 0.48 * PI), [0, 0.185, -0.02], [1, 1, 1], [-0.18, 0, 0]), part(ball(0.06), [0, 0.24, -0.17]),
    part(tube(0.042, 0.26), [0, 0.1, -0.225], [1, 1, 1], [0.28, 0, 0]), part(ball(0.05), [0, -0.02, -0.255]),
  ]) }),
  braids: () => {
    const parts = [part(cap(0.184, 0.48 * PI), [0, 0.185, -0.02], [1, 1, 1], [-0.18, 0, 0])];
    for (let k = 0; k < 7; k++) {
      const t = -1.2 + (k / 6) * 2.4, x = Math.sin(t) * 0.15, z = -Math.cos(t) * 0.15 - 0.01;
      parts.push(part(tube(0.02, 0.27), [x, 0.03, z], [1, 1, 1], [-z * 0.4, 0, x * 0.5]));
    }
    return { hair: mergeGeometries(parts) };
  },
  mohawk: () => ({ hair: mergeGeometries([part(cap(0.172, 0.4 * PI), [0, 0.19, -0.014], [1, 1, 1], [-0.14, 0, 0]), part(box(0.045, 0.1, 0.26), [0, 0.325, -0.03], [1, 1, 1], [0.1, 0, 0])]) }),
  headband: () => ({ hair: part(cap(0.18, 0.5 * PI), [0, 0.172, -0.012]), trim: part(new THREE.CylinderGeometry(0.176, 0.176, 0.05, 20, 1, true), [0, 0.225, -0.004]) }),
};

// Facial hair as thin shells just outside the head sphere. The sphere's polar angle runs from the top (0) to the
// bottom (PI); phi picks a wedge, and a -PI/2 offset points the wedge's middle at +z (the face).
const wedge = (r, half, t0, t1) => {
  // THREE.SphereGeometry: x = -r cos(phi) sin(theta), z = r sin(phi) sin(theta), so +z is phi = PI/2
  const g = new THREE.SphereGeometry(r, 24, 10, PI / 2 - half, 2 * half, t0, t1 - t0);
  return g;
};
const BEARD = {
  none: () => ({}),
  stubble: () => ({ stubble: wedge(0.1725, 0.62 * PI, 0.58 * PI, 0.86 * PI) }),
  moustache: () => ({ solid: part(box(0.095, 0.022, 0.028), [0, 0.108, 0.164], [1, 1, 1], [0.1, 0, 0]) }),
  beard: () => ({ solid: mergeGeometries([wedge(0.1795, 0.55 * PI, 0.58 * PI, 0.92 * PI), part(box(0.1, 0.022, 0.028), [0, 0.108, 0.168], [1, 1, 1], [0.1, 0, 0])]) }),
};

const cache = {};
export const hairGeometry = (style) => (cache['h' + style] ||= (BUILD[style] || BUILD.short)());
export const beardGeometry = (kind) => (cache['b' + kind] ||= (BEARD[kind] || BEARD.none)());
