import test from 'node:test';
import assert from 'node:assert/strict';
import { Environment } from '../src/env.js';

// Environment needs a canvas for the sky, so the parts under test are run on a stand-in object
const proto = Environment.prototype;
const make = (windAngle) => { const e = { windAngle, seedWind: proto.seedWind, makeWind: proto.makeWind }; return e; };

test('wind streaks have finite coordinates for every direction, including the default angle 0', () => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2, 3 * Math.PI / 4]) {
    const w = make(angle).makeWind();
    assert.ok(w.pos.every(Number.isFinite), `angle ${angle}`);
    assert.equal(w.pos.length, w.N * 6);
  }
});

test('a missing or broken wind angle falls back to 0 instead of producing NaN', () => {
  for (const bad of [undefined, NaN, null, Infinity]) {
    const e = make(bad); const w = e.makeWind();
    assert.ok(w.pos.every(Number.isFinite), String(bad));
  }
});

test('the streaks blow along the wind direction', () => {
  const e = make(Math.PI / 2); const w = e.makeWind();
  for (let i = 0; i < w.N; i++) { const o = i * 6; assert.ok(Math.abs(w.pos[o + 3] - w.pos[o]) < 1e-5 && w.pos[o + 5] > w.pos[o + 2]); }
});

test('update repairs streaks that went NaN', () => {
  const e = make(0); const w = e.makeWind();
  e.wind = w; e.weather = 'wind'; e.rain = { N: 0 }; e.snow = { N: 0 };
  w.pos[3] = NaN;
  proto.update.call(e, 0.016);
  assert.ok(w.pos.every(Number.isFinite));
});
