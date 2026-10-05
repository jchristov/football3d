import { MATCH, TEAM_SIZES, PITCH } from './constants.js';

// Formations are lists of "lines" (players per line, from the defence to the attack). Positions are normalised:
// nx = 0..1 along the length of the pitch (0 = own goal line), nz = -1..1 across its width. They are turned into
// metres with homeSlots(), so the same formation fits every pitch size.
const LINE_DEPTH = { 1: [0.45], 2: [0.24, 0.62], 3: [0.26, 0.46, 0.66], 4: [0.22, 0.37, 0.52, 0.68] };

function F(key, label, short, desc, lines, tag, o = {}) {
  return { key, label, short, desc, lines, tag, attack: o.attack ?? 0, shift: o.shift ?? 0.42, width: o.width ?? 1, depth: o.depth || null, role: o.role || null };
}

// tag: balanced / attack / park / diamond / alt: lets the CPU choose a style that suits it at any team size
export const FORMATIONS_BY_SIZE = {
  3: [
    F('1-1', '1-1 Balanced', '1-1', 'One defender, one attacker.', [1, 1], 'balanced'),
    F('2-atk', '2 Twin strikers', '2 up', 'Both players push forward. Risky!', [2], 'attack', { attack: 1, shift: 0.5, role: 'FWD' }),
    F('2-def', '2 Double wall', '2 back', 'Both players stay back.', [2], 'park', { attack: -1, shift: 0.3, role: 'DEF' }),
    F('1-1-w', '1-1 Narrow', '1-1 N', 'Tight and central.', [1, 1], 'diamond', { width: 0.5 }),
    F('2-mid', '2 Midfield pair', '2 mid', 'Two players side by side in the middle.', [2], 'alt', { role: 'MID' }),
  ],
  4: [
    F('1-1-1', '1-1-1 Balanced', '1-1-1', 'A line down the pitch.', [1, 1, 1], 'balanced'),
    F('2-1', '2-1 Solid', '2-1', 'Two defenders and a lone attacker.', [2, 1], 'park', { attack: -1, shift: 0.3 }),
    F('1-2', '1-2 Attacking', '1-2', 'One defender, two attackers.', [1, 2], 'attack', { attack: 1, shift: 0.5 }),
    F('1-1-1n', '1-1-1 Narrow', '1-1-1 N', 'Compact and central.', [1, 1, 1], 'diamond', { width: 0.5 }),
    F('3-0', '3 Flat line', '3', 'Three across the middle.', [3], 'alt', { role: 'MID' }),
  ],
  5: [
    F('balanced', '1-2-1 Balanced', '1-2-1', 'Defender, two midfielders and a lone striker.', [1, 2, 1], 'balanced'),
    F('twotwo', '2-2 Square', '2-2', 'Two defenders, two forwards: solid at the back, direct up front.', [2, 2], 'alt', { shift: 0.36, depth: [0.24, 0.62] }),
    F('diamond', '1-1-1-1 Diamond', '1-2-1 D', 'A narrow diamond: great cover, thin wings.', [1, 2, 1], 'diamond', { attack: 0.2, shift: 0.4, width: 0.62, depth: [0.22, 0.42, 0.66] }),
    F('attack', '1-1-2 All-out attack', '1-1-2', 'One holding player and three attackers. Risky!', [1, 1, 2], 'attack', { attack: 1, shift: 0.5, depth: [0.34, 0.56, 0.74] }),
    F('park', '3-1 Park the bus', '3-1', 'Three defenders and a single outlet. Hard to beat.', [3, 1], 'park', { attack: -1, shift: 0.3, depth: [0.2, 0.52] }),
  ],
  7: [
    F('2-3-1', '2-3-1 Balanced', '2-3-1', 'Two defenders, three midfielders, one striker.', [2, 3, 1], 'balanced'),
    F('3-2-1', '3-2-1 Solid', '3-2-1', 'A back three and a compact middle.', [3, 2, 1], 'park', { attack: -1, shift: 0.3 }),
    F('2-2-2', '2-2-2 Square', '2-2-2', 'Evenly spread, two strikers.', [2, 2, 2], 'alt'),
    F('3-1-2', '3-1-2 Counter', '3-1-2', 'Defend deep, hit on the break.', [3, 1, 2], 'diamond', { attack: 0.2 }),
    F('1-3-2', '1-3-2 Attacking', '1-3-2', 'One holding player, a busy midfield, two strikers.', [1, 3, 2], 'attack', { attack: 1, shift: 0.5 }),
  ],
  9: [
    F('3-3-2', '3-3-2 Balanced', '3-3-2', 'A back three, a midfield three and two strikers.', [3, 3, 2], 'balanced'),
    F('4-3-1', '4-3-1 Solid', '4-3-1', 'A flat back four and one striker.', [4, 3, 1], 'park', { attack: -1, shift: 0.3 }),
    F('3-4-1', '3-4-1 Midfield', '3-4-1', 'Four in midfield to control the game.', [3, 4, 1], 'diamond', { attack: 0.2 }),
    F('2-4-2', '2-4-2 Attacking', '2-4-2', 'Two at the back, two up front.', [2, 4, 2], 'alt', { attack: 0.5, shift: 0.48 }),
    F('3-2-3', '3-2-3 All-out attack', '3-2-3', 'Three forwards. Risky!', [3, 2, 3], 'attack', { attack: 1, shift: 0.5 }),
  ],
  11: [
    F('4-4-2', '4-4-2 Balanced', '4-4-2', 'The classic: two banks of four and two strikers.', [4, 4, 2], 'balanced'),
    F('5-3-2', '5-3-2 Park the bus', '5-3-2', 'A back five. Hard to beat.', [5, 3, 2], 'park', { attack: -1, shift: 0.3 }),
    F('4-5-1', '4-5-1 Midfield', '4-5-1', 'A packed midfield and one striker.', [4, 5, 1], 'diamond', { attack: 0.1 }),
    F('4-3-3', '4-3-3 Attacking', '4-3-3', 'Three forwards, a flexible midfield.', [4, 3, 3], 'alt', { attack: 0.5, shift: 0.48 }),
    F('3-4-3', '3-4-3 All-out attack', '3-4-3', 'Three at the back, three up front. Risky!', [3, 4, 3], 'attack', { attack: 1, shift: 0.5 }),
  ],
};

export const sizesWithFormations = TEAM_SIZES;
export const formationsFor = (size = MATCH.size) => FORMATIONS_BY_SIZE[size] || FORMATIONS_BY_SIZE[5];
// Keyed by formation key; used where a lookup is needed
export const formationMap = (size = MATCH.size) => Object.fromEntries(formationsFor(size).map((f) => [f.key, f]));
// The 5-a-side set, keyed (kept for convenience)
export const FORMATIONS = formationMap(5);
export const FORMATION_KEYS = Object.keys(FORMATIONS);

export const DEFAULT_FORMATION = (size = MATCH.size) => formationsFor(size)[0].key;
// A stored choice that does not exist at this team size falls back to the balanced formation
export const resolveFormation = (key, size = MATCH.size) => (formationMap(size)[key] ? key : DEFAULT_FORMATION(size));
export const formationOf = (t, size = MATCH.size) => formationMap(size)[resolveFormation(t?.formation, size)];

// press: how many players chase the ball and how high the line is (chasers are scaled to the team size, see chasersFor)
export const PRESS = {
  low: { label: 'Sit back', desc: 'Stay compact, let them come.', chasers: 1, line: -3, tackle: 0.75, speed: 0.98 },
  balanced: { label: 'Balanced', desc: 'A normal mix of pressing and shape.', chasers: 2, line: 0, tackle: 1, speed: 1 },
  high: { label: 'High press', desc: 'Win it back early. Tiring and risky.', chasers: 3, line: 4, tackle: 1.25, speed: 1.03, drain: 1.5 },
};
export const PRESS_KEYS = Object.keys(PRESS);

export const DEFAULT_TACTICS = { formation: 'balanced', press: 'balanced' };

export const pressOf = (t) => PRESS[t?.press] || PRESS.balanced;
// 4 outfield players is the reference: more players chase on bigger teams, but not proportionally
export const chasersFor = (press, size = MATCH.size) => Math.max(1, Math.round(press.chasers * Math.sqrt((size - 1) / 4)));

// CPU teams choose a style that suits their strength unless told otherwise
export function cpuTactics(rating = 3, size = MATCH.size, style = null) {
  const pick = (tag) => (formationsFor(size).find((f) => f.tag === tag) || formationsFor(size)[0]).key;
  if (style && style.tag) return { formation: pick(style.tag), press: style.press || 'balanced' }; // the style decides the shape and the pressing
  if (rating >= 5) return { formation: pick('attack'), press: 'high' };
  if (rating === 4) return { formation: pick('diamond'), press: 'balanced' };
  if (rating <= 2) return { formation: pick('park'), press: 'low' };
  return { formation: pick('balanced'), press: 'balanced' };
}

// Normalised positions of the outfield players of a formation: [{ role, nx, nz }]
export function layout(f) {
  const total = f.lines.length;
  const depths = f.depth || LINE_DEPTH[total] || LINE_DEPTH[3];
  const out = [];
  f.lines.forEach((count, li) => {
    const role = f.role || (total === 1 ? 'MID' : li === 0 ? 'DEF' : li === total - 1 ? 'FWD' : 'MID');
    const nx = Math.max(0.1, Math.min(0.8, depths[li] + 0.05 * f.attack));
    const extreme = Math.min(0.88, (0.22 + 0.14 * count)) * f.width;
    for (let k = 0; k < count; k++) {
      const nz = count === 1 ? 0 : extreme * (-1 + (2 * k) / (count - 1));
      out.push({ role, nx, nz });
    }
  });
  return out;
}

// Home slots for a team on the CURRENT pitch: the keeper, then the outfield positions in metres (local coordinates:
// lx = 0 at the own goal line, 2 * half-length at the opponent's; lz = sideways).
export function homeSlots(formationKey, size = MATCH.size, pitch = null) {
  const f = formationMap(size)[resolveFormation(formationKey, size)];
  const P = pitch || globalPitch();
  return [{ role: 'GK', lx: 1.3, lz: 0 }, ...layout(f).map((s) => ({ role: s.role, lx: s.nx * 2 * P.hl, lz: s.nz * P.hw }))];
}

const globalPitch = () => PITCH;

// The "line" the whole team shifts to depending on score: trailing teams push up, leaders drop deeper
export function gameStateShift(scoreDiff, timeLeftFrac) {
  const urgency = Math.max(0, 1 - timeLeftFrac); // grows through the match
  if (scoreDiff < 0) return Math.min(6, -scoreDiff * 1.5 * (0.5 + urgency));
  if (scoreDiff > 0) return -Math.min(4, scoreDiff * 1.2 * (0.5 + urgency));
  return 0;
}
