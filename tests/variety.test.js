import test from 'node:test';
import assert from 'node:assert/strict';
import { WEATHERS } from '../src/env.js';
import { STADIUM_LOOKS } from '../src/world.js';
import { cleanMenuChoices } from '../src/menu.js';
import { makeDefaults } from '../src/settings.js';
import { makeGame, startCpuMatch, step, seedRandom, resetGlobals } from './helpers.js';

test.beforeEach(() => resetGlobals());

test('mud makes the going heavy and tiring, wind pushes the ball; clear weather is neutral', () => {
  assert.ok(WEATHERS.mud.grip < 1 && WEATHERS.mud.roll > 1 && WEATHERS.mud.drain > 1);
  assert.ok(WEATHERS.wind.wind > 0 && !WEATHERS.mud.wind && !WEATHERS.clear.wind);
  assert.equal(WEATHERS.clear.drain, undefined);
});

function withWeather(g, weather) {
  g.env.set = (time, w, angle) => { g.env.weather = w; g.env.windAngle = angle ?? g.env.windAngle; g.env.physics = WEATHERS[w]; };
}

test('applyEnv hands the conditions to players and ball', () => {
  const g = makeGame(); withWeather(g, 'mud');
  g.applyEnv({ time: 'day', weather: 'mud' });
  assert.equal(g.all[0].grip, WEATHERS.mud.grip); assert.equal(g.all[0].envDrain, 1.15);
  assert.equal(g.ball.roll, 1.5); assert.equal(g.ball.windAcc, null);
  g.applyEnv({ time: 'day', weather: 'wind', windAngle: Math.PI / 2 });
  assert.ok(Math.abs(g.ball.windAcc.z - 3.4) < 1e-9 && Math.abs(g.ball.windAcc.x) < 1e-9);
  assert.equal(g.all[0].envDrain, 1);
  g.applyEnv({ time: 'day', weather: 'clear' });
  assert.equal(g.ball.windAcc, null);
});

test('wind only moves a ball that is in the air, and in the wind direction', () => {
  const g = makeGame(); withWeather(g, 'wind');
  g.applyEnv({ time: 'day', weather: 'wind', windAngle: 0 }); // blowing towards +x
  const b = g.ball;
  b.reset(0, 0); b.vel.set(0, 8, 0); // a high ball
  b.step(0.5);
  assert.ok(b.vel.x > 0.5, `x velocity ${b.vel.x}`);
  b.reset(0, 0); b.vel.set(0, 0, 0);
  b.step(0.5);
  assert.ok(Math.abs(b.vel.x) < 0.01, 'a ball on the ground is not pushed');
});

test('mud tires the players faster than clear weather', () => {
  const run = (weather, seed) => {
    seedRandom(seed);
    const g = makeGame(); withWeather(g, weather);
    startCpuMatch(g, { length: 120, env: { time: 'day', weather } });
    const p = g.teams[0][2];
    p.pos.set(-10, 0, 0); p.stunT = 0; p.energy = 1;
    for (let i = 0; i < 600; i++) { p.vel.set(6, 0, 0); p.move(1, 0, false, 1 / 60); }
    return p.energy;
  };
  assert.ok(run('mud', 1) < run('clear', 1));
});

test('start-screen choices include the new weather and the stadium look', () => {
  assert.equal(cleanMenuChoices({ weather: 'mud', stadium: 'neon' }).weather, 'mud');
  assert.equal(cleanMenuChoices({ weather: 'wind' }).weather, 'wind');
  assert.equal(cleanMenuChoices({ stadium: 'bogus' }).stadium, 'arena');
  assert.deepEqual(cleanMenuChoices(undefined), makeDefaults().menu);
});

test('every stadium look has stands, a crowd palette and five advertising boards', () => {
  assert.deepEqual(Object.keys(STADIUM_LOOKS), ['arena', 'classic', 'neon']);
  for (const l of Object.values(STADIUM_LOOKS)) {
    assert.ok(l.label && Number.isInteger(l.concrete)); assert.ok(l.crowd.length >= 6); assert.equal(l.ads.length, 5);
  }
  assert.notDeepEqual(STADIUM_LOOKS.classic.crowd, STADIUM_LOOKS.neon.crowd);
});
