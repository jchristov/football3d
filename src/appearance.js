import { settings } from './settings.js';

// Player appearance: skin tone (continuous scale), hair colour and style, facial hair and boots.
// Every squad player gets a deterministic look derived from (team, slot), unique across the whole game,
// shaped by a per-team "look profile". Players can be re-styled in the squad editor (stored in settings.custom).

export const SKIN_TONES = [0xfbe3d0, 0xf1c8a4, 0xe3ad82, 0xd29a68, 0xbb7f4e, 0xa66d42, 0x8f5a35, 0x7a4a2c, 0x663d25, 0x54321e];
export const SKIN_MAX = SKIN_TONES.length - 1;

export const HAIR_COLORS = [
  { key: 'black', label: 'Black', hex: 0x14110f },
  { key: 'darkbrown', label: 'Dark brown', hex: 0x2e1d12 },
  { key: 'brown', label: 'Brown', hex: 0x4b2f1c },
  { key: 'chestnut', label: 'Chestnut', hex: 0x6e4325 },
  { key: 'darkblonde', label: 'Dark blonde', hex: 0x9a7a3c },
  { key: 'blonde', label: 'Blonde', hex: 0xd4b15a },
  { key: 'platinum', label: 'Platinum', hex: 0xefe2b8 },
  { key: 'ginger', label: 'Ginger', hex: 0xb4501f },
  { key: 'grey', label: 'Grey', hex: 0x8d8d92 },
  { key: 'white', label: 'White', hex: 0xe8e8ec },
  { key: 'blue', label: 'Blue (dyed)', hex: 0x2f6fe0 },
  { key: 'red', label: 'Red (dyed)', hex: 0xc0262d },
];

export const HAIR_STYLES = ['buzz', 'short', 'side', 'curly', 'afro', 'long', 'ponytail', 'braids', 'mohawk', 'bald', 'headband'];
export const STYLE_LABELS = { buzz: 'Buzz cut', short: 'Short', side: 'Side part', curly: 'Curly', afro: 'Afro', long: 'Long', ponytail: 'Ponytail', braids: 'Braids', mohawk: 'Mohawk', bald: 'Bald', headband: 'Headband' };

export const BEARDS = ['none', 'stubble', 'moustache', 'beard'];
export const BEARD_LABELS = { none: 'Clean shaven', stubble: 'Stubble', moustache: 'Moustache', beard: 'Full beard' };

export const BOOT_COLORS = [
  { key: 'black', label: 'Black', hex: 0x15161a }, { key: 'white', label: 'White', hex: 0xf2f2f2 }, { key: 'neon', label: 'Neon', hex: 0xc6ff00 },
  { key: 'orange', label: 'Orange', hex: 0xff7a1a }, { key: 'blue', label: 'Blue', hex: 0x2979ff }, { key: 'pink', label: 'Pink', hex: 0xff4fa3 },
  { key: 'gold', label: 'Gold', hex: 0xd9a520 }, { key: 'red', label: 'Red', hex: 0xe0242b },
];

// A squad has 16 members: enough for 11 starters and a bench of 5. Which of them play depends on the team size:
// the first N are the starting team, the next few are the bench (see benchSize), the rest are not in the match squad.
export const SLOTS = 16;
export const SLOT_NUMBERS = [1, 4, 8, 10, 9, 3, 7, 11, 5, 6, 2, 12, 13, 14, 15, 16];
export const SLOT_ROLES = ['GK', 'DEF', 'MID', 'MID', 'FWD', 'DEF', 'MID', 'FWD', 'DEF', 'MID', 'DEF', 'MID', 'FWD', 'DEF', 'MID', 'FWD'];
export const CAPTAIN_SLOT = 1;

// Per-team look profile: mean skin tone, spread, beard chance, "wild" (dyed hair / mohawks) and hair colour bias
export const TEAM_PROFILES = [
  { skin: 3, spread: 3.5, beard: 0.25, wild: 0.15 },
  { skin: 2, spread: 2.5, beard: 0.35, wild: 0.2, bias: { ginger: 1.6, blonde: 1.4 } },
  { skin: 6, spread: 3, beard: 0.3, wild: 0.25, bias: { afro: 1.5 } },
  { skin: 4, spread: 4, beard: 0.2, wild: 0.3 },
  { skin: 7, spread: 2.5, beard: 0.3, wild: 0.35, bias: { braids: 1.8, afro: 1.4 } },
  { skin: 2, spread: 2, beard: 0.4, wild: 0.15, bias: { ginger: 3.2, chestnut: 1.5 } },
  { skin: 3, spread: 4, beard: 0.5, wild: 0.1, bias: { grey: 2.6, white: 2, bald: 1.6 } },
  { skin: 5, spread: 4.5, beard: 0.25, wild: 0.3 },
];

const clampSkin = (v) => Math.max(0, Math.min(SKIN_MAX, v));

export function skinHex(v) {
  v = clampSkin(v);
  const i = Math.floor(v), f = v - i;
  if (i >= SKIN_MAX) return SKIN_TONES[SKIN_MAX];
  const a = SKIN_TONES[i], b = SKIN_TONES[i + 1];
  const mix = (s) => Math.round(((a >> s) & 255) * (1 - f) + ((b >> s) & 255) * f);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted(r, entries) {
  const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
  let x = r() * total;
  for (const [k, w] of entries) { x -= Math.max(0, w); if (x <= 0) return k; }
  return entries[entries.length - 1][0];
}

function roll(teamIdx, slot, attempt) {
  const P = TEAM_PROFILES[teamIdx % TEAM_PROFILES.length];
  const r = rng(teamIdx * 7919 + slot * 131 + attempt * 104729 + 17);
  const gauss = () => (r() + r() + r() - 1.5) * 2; // roughly -3..3
  const skin = Math.round(clampSkin(P.skin + gauss() * (P.spread / 3)) * 2) / 2;
  const dark = skin / SKIN_MAX; // 0 light .. 1 dark
  const bias = P.bias || {};
  const hairW = {
    black: 3 * (0.5 + dark * 3), darkbrown: 3 * (0.6 + dark * 2), brown: 3 * (1.2 - dark * 0.9), chestnut: 2 * (1.1 - dark * 0.9),
    darkblonde: 2 * (1 - dark) ** 2, blonde: 2 * (1 - dark) ** 3, platinum: 0.6 * (1 - dark) ** 3, ginger: 0.8 * (1 - dark) ** 3,
    grey: 0.6, white: 0.2, blue: P.wild * 0.8, red: P.wild * 0.6,
  };
  for (const k of Object.keys(bias)) if (k in hairW) hairW[k] *= bias[k];
  const hair = weighted(r, HAIR_COLORS.map((c) => [c.key, hairW[c.key]]));
  const styleW = {
    buzz: 2, short: 3, side: 2.5, curly: 1.2 + dark * 1.5, afro: 0.15 + dark * 2.2, long: 1, ponytail: 0.9, braids: 0.3 + dark * 1.4,
    mohawk: 0.3 + P.wild * 1.6, bald: 0.6, headband: 0.8,
  };
  for (const k of Object.keys(bias)) if (k in styleW) styleW[k] *= bias[k];
  const style = weighted(r, HAIR_STYLES.map((s) => [s, styleW[s]]));
  const b = P.beard;
  const beard = weighted(r, [['none', 1 - b], ['stubble', b * 0.45], ['moustache', b * 0.2], ['beard', b * 0.35]]);
  const boots = weighted(r, BOOT_COLORS.map((c, i) => [c.key, [3, 2, 1, 0.8, 0.8, 0.5, 0.5, 1][i]]));
  return { skin, hair: style === 'bald' ? 'black' : hair, style, beard, boots };
}

export const signature = (l) => `${l.skin}|${l.style === 'bald' ? '-' : l.hair}|${l.style}|${l.beard}|${l.boots}`;

// All squads are generated once, in a fixed order, re-rolling any look that duplicates an earlier one.
// The first 8 players of every team are generated first, so they look the same whatever the team size.
const TABLE = (() => {
  const used = new Set(), t = TEAM_PROFILES.map(() => []);
  const gen = (from, to) => {
    for (let team = 0; team < TEAM_PROFILES.length; team++) {
      for (let slot = from; slot < to; slot++) {
        let look = roll(team, slot, 0), n = 0;
        while (used.has(signature(look)) && n < 400) look = roll(team, slot, ++n);
        used.add(signature(look));
        t[team][slot] = look;
      }
    }
  };
  gen(0, 8);
  gen(8, SLOTS);
  return t;
})();

export const defaultLook = (teamIdx, slot) => ({ ...TABLE[teamIdx][slot] });

const valid = (v, list) => list.some((x) => (x.key || x) === v);

// The look of a squad player: generated, with any editor overrides applied on top
export function lookFor(teamIdx, slot) {
  const base = defaultLook(teamIdx, slot);
  const o = settings.custom?.[`${teamIdx}-${slot}`];
  if (!o) return base;
  const look = { ...base };
  if (typeof o.skin === 'number') look.skin = clampSkin(o.skin);
  if (valid(o.hair, HAIR_COLORS)) look.hair = o.hair;
  if (valid(o.style, HAIR_STYLES)) look.style = o.style;
  if (valid(o.beard, BEARDS)) look.beard = o.beard;
  if (valid(o.boots, BOOT_COLORS)) look.boots = o.boots;
  return look;
}

export const hairHex = (key) => (HAIR_COLORS.find((c) => c.key === key) || HAIR_COLORS[0]).hex;
export const bootHex = (key) => (BOOT_COLORS.find((c) => c.key === key) || BOOT_COLORS[0]).hex;

// Same shape for the editor: a random look (not tied to the generated table)
export function randomLook(teamIdx = 0) {
  return roll(teamIdx, Math.floor(Math.random() * SLOTS), 1000 + Math.floor(Math.random() * 100000));
}

export function cleanName(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z' -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
}
