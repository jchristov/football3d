import * as THREE from 'three';
import { Game } from '../src/game.js';
import { Input } from '../src/input.js';
import { SIDES, setBallSize, setPitchForSize } from '../src/constants.js';
import { settings } from '../src/settings.js';

// Shared module state (which way teams attack, ball size) must not leak from one test into the next
export function resetGlobals() { SIDES.flip = 1; setBallSize(5); setPitchForSize(5); }

// A Proxy that accepts any call and returns itself: stands in for the HUD and audio in headless runs.
export const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });

export function makeGame(opts = {}) {
  resetGlobals();
  settings.restarts = !!opts.restarts; // boards by default: the older tests were written for a ball that bounces back
  settings.injuries = !!opts.injuries; // random injuries would change the seeded simulations of the older tests
  settings.var = !!opts.var; // the VAR review delays cards and penalties; only the VAR tests want it
  const input = new Input(null);
  const env = { physics: { grip: 1, roll: 1 }, time: 'day', weather: 'clear', set() {}, update() {} };
  const world = { confetti: { update() {}, burst() {} }, crowd: { update() {}, animate: true }, rebuild() {}, pitchScale: 1 };
  const game = new Game({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(45, 1.6, 0.5, 400), world, env, hud: noop, sfx: noop, input });
  game.hud = { ...Object.fromEntries(['setBanner', 'hideBanner', 'toast', 'showReplay', 'setBestGoal', 'renderStats', 'renderScorers', 'setEnd', 'showEnd', 'showMenu', 'show', 'setTeams', 'setAutopilot', 'setControlsHelp', 'setPens', 'showPause', 'showCommentary', 'update', 'showCard', 'hideCard', 'renderRatings', 'renderAnalysis'].map((k) => [k, () => {}])) };
  game.hud.varEl = { className: '' }; // the VAR monitor: remembers its last state
  game.hud.showVar = (state) => { game.hud.varEl.className = `show ${state}`; };
  game.hud.hideVar = () => { game.hud.varEl.className = ''; };
  game.comm.hud = game.hud;
  if (opts.seed !== undefined) seedRandom(opts.seed);
  return game;
}

export function runUntil(game, cond, maxSeconds = 600) {
  const dt = 1 / 60;
  let t = 0;
  while (!cond() && t < maxSeconds) {
    game.update(dt);
    if (game.state === 'replay') game.endReplay();
    t += dt;
  }
  return t;
}

export function step(game, seconds) { for (let i = 0; i < Math.round(seconds * 60); i++) game.update(1 / 60); }

export function startCpuMatch(game, over = {}) {
  game.startMatch({ mode: 'cpu', teams: [0, 1], diff: 'normal', length: 60, knockout: false, env: { time: 'day', weather: 'clear' }, ...over });
}

// Deterministic Math.random (mulberry32) so simulations are reproducible
export function seedRandom(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
