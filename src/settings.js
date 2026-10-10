// Persistent user settings (localStorage), shared by audio, graphics, controls and the match setup.
const KEY = 'football3d.settings';

// A factory so nested objects are never shared between the defaults and the live settings
export const makeDefaults = () => ({
  master: 0.8,
  sfx: 1,
  crowd: 1,
  quality: 'high', // 'high' | 'medium' | 'low'
  length: 180, // friendly match length in seconds
  commentary: true,
  clockUp: false, // the match clock counts up (elapsed time) instead of down (time left in the half)
  ball: 'classic', // a face key from ballskin.js, or 'random'
  ballSize: 5, // standard football sizes 1-5 (see BALL_SIZES in constants.js)
  teamSize: 5, // players per side: 3, 4, 5, 7, 9 or 11 (see TEAM_SIZES)
  tts: true, // spoken commentary (Web Speech API)
  ttsVoice: '', // voiceURI, '' = automatic
  ttsRate: 1.05,
  ttsVolume: 1,
  panelOpacity: 0.86, // opacity of every overlay panel (menu, settings, tactics, help ...), 0.3 - 1
  muted: false, // sound muted (M)
  camera: 'broadcast', // the match camera: 'broadcast' | 'follow' (selected player) | 'ball' | 'top' (C)
  menu: { mode: '1p', comp: 'friendly', diff: 'normal', teamA: 0, teamB: 1, time: 'day', weather: 'clear', stadium: 'arena' }, // the choices on the start screen
  lineupScreen: true, // the team sheets before kick-off
  mouse: true, // mouse control: run to the pointer, left click shoot, right click pass, middle click tackle, wheel switch
  cpuToughness: 2, // how tough the CPU opponent plays in a 1-player match, 1 (very easy) - 5 (relentless)
  swapHalves: true, // the teams change ends after half-time (off: they keep their sides)
  restarts: true, // throw-ins, corners and goal kicks (off: the ball bounces off the boards)
  autoQuality: true, // lower the graphics quality automatically when the frame rate is poor
  colorBlind: false, // colour-blind-safe palette for the speciality bars and the cards
  touchHint: true, // show the how-to-play hint of the touch controls once
  touchScale: 1, // size of the touch buttons on phones and tablets, 0.6 - 1.4
  uiScale: 1, // size of the on-screen widgets and panels, 0.8 - 1.5
  reducedMotion: null, // null = follow the system preference, true / false = chosen in Settings
  announcer: true, // stadium announcer (PA voice) for line-ups, goals, cards and substitutions
  var: true, // VAR: a short video review of penalties and straight red cards that can overturn them
  injuries: true, // hard challenges can injure players
  netStun: false, // online play: use a public STUN server to find the way through routers
  playerBars: true, // energy and speciality bars of the player with the ball and of the human players (G)
  events: false, // the match-events panel under the score widget (I)
  minimap: true, // the bird's-eye minimap in the bottom-right corner (B)
  offside: false, // optional offside rule
  tactics: { formation: 'balanced', press: 'balanced' }, // the human team's default tactics
  custom: {}, // squad editor overrides: { 'team-slot': { name, skin, hair, style, beard, boots, eyes } }
  bindings: {}, // { solo|p1|p2: { action: [KeyboardEvent.code, ...] } } — only the user's overrides
});
export const DEFAULTS = makeDefaults();

const store = () => (typeof localStorage !== 'undefined' ? localStorage : null);
const listeners = new Set();

export const settings = makeDefaults();

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(store()?.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
  // the mute flag used to live under its own key
  if (saved.muted === undefined && store()?.getItem('football3d.muted') === '1') saved.muted = true;
  Object.assign(settings, makeDefaults(), saved);
  for (const k of ['bindings', 'custom', 'tactics', 'menu']) if (!settings[k] || typeof settings[k] !== 'object') settings[k] = makeDefaults()[k];
  settings.tactics = { ...makeDefaults().tactics, ...settings.tactics };
  settings.menu = { ...makeDefaults().menu, ...settings.menu };
  return settings;
}

export function saveSettings() {
  try { store()?.setItem(KEY, JSON.stringify(settings)); } catch { /* storage full or blocked */ }
  for (const f of listeners) f(settings);
}

export function resetSettings() {
  const muted = settings.muted; // the sound switch is a toggle of its own, not part of the reset
  Object.assign(settings, makeDefaults());
  settings.muted = muted;
  saveSettings();
}

export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }

loadSettings();

// Accessibility helpers (pure, so they can be tested)
export const clampTouchScale = (v) => Math.min(1.4, Math.max(0.6, Number(v) || 1));
export const CPU_TOUGHNESS = ['Very easy', 'Easy', 'Normal', 'Hard', 'Relentless'];
export const clampToughness = (v) => Math.min(5, Math.max(1, Math.round(Number(v)) || 2));
export const clampUiScale = (v) => Math.min(1.5, Math.max(0.8, Number(v) || 1));
export const motionReduced = (s = settings, systemPrefers = false) => (s.reducedMotion === null || s.reducedMotion === undefined ? !!systemPrefers : !!s.reducedMotion);
