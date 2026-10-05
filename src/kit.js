import * as THREE from 'three';

const cache = new Map();

const css = (n) => '#' + n.toString(16).padStart(6, '0');
export const luminance = (n) => (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;

function tex(key, w, h, draw) {
  if (typeof document === 'undefined') return null; // headless (tests)
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

// Shirt fabric wrapped round the torso: plain, vertical stripes or hoops
export function shirtTexture(base, trim, pattern) {
  return tex(`shirt-${base}-${trim}-${pattern}`, 128, 128, (g, w, h) => {
    g.fillStyle = css(base);
    g.fillRect(0, 0, w, h);
    g.fillStyle = css(trim);
    if (pattern === 'stripes') for (let x = 0; x < w; x += 32) g.fillRect(x + 8, 0, 16, h);
    if (pattern === 'hoops') for (let y = 0; y < h; y += 32) g.fillRect(0, y + 10, w, 14);
  });
}

const ink = (shirt) => (luminance(shirt) > 0.55 ? { fill: '#0d1020', edge: '#ffffff' } : { fill: '#ffffff', edge: '#0d1020' });

// Big shirt number: filled, with a thick outline in the opposite colour so it reads on any stripe or hoop.
// The glyphs are squeezed horizontally (never shrunk) when they would not fit the width, like a condensed bold font.
function bigNumber(g, text, cx, top, bottom, maxW, c) {
  const h = bottom - top;
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.font = `900 ${Math.round(h * 1.38)}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;
  const m = g.measureText(text);
  const ascent = m.actualBoundingBoxAscent || h, descent = m.actualBoundingBoxDescent || 0;
  const glyphH = ascent + descent;
  const sy = h / glyphH; // scale so the digits are exactly `h` tall
  const wNeeded = (m.actualBoundingBoxLeft + m.actualBoundingBoxRight || m.width) * 1;
  const sx = Math.min(1, maxW / Math.max(1, wNeeded));
  g.translate(cx, bottom - descent * sy);
  g.scale(sx, sy);
  g.lineWidth = Math.max(10, h * 0.07) / Math.min(sx, sy);
  g.strokeStyle = c.edge;
  g.strokeText(text, 0, 0);
  g.fillStyle = c.fill;
  g.fillText(text, 0, 0);
  g.restore();
}

// Decal for the back of the shirt: surname across the shoulders, a very large squad number below it
export function backTexture(num, name, shirt) {
  const c = ink(shirt);
  return tex(`back2-${num}-${name}-${c.fill}`, 512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    let size = 74;
    g.font = `900 ${size}px "Arial Black", Impact, Arial, sans-serif`;
    while (g.measureText(name).width > w * 0.9 && size > 26) { size -= 2; g.font = `900 ${size}px "Arial Black", Impact, Arial, sans-serif`; }
    g.lineWidth = 9;
    g.strokeStyle = c.edge;
    g.strokeText(name, w / 2, 50);
    g.fillStyle = c.fill;
    g.fillText(name, w / 2, 50);
    bigNumber(g, String(num), w / 2, 104, h - 20, w * 0.92, c);
  });
}

export function frontTexture(num, shirt) {
  const c = ink(shirt);
  return tex(`front2-${num}-${c.fill}`, 256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    bigNumber(g, String(num), w / 2, 18, h - 18, w * 0.9, c);
  });
}
