// Team sizes (players per side, goalkeeper included) and the pitch that goes with each
export const TEAM_SIZES = [3, 4, 5, 7, 9, 11];
export const PITCH_SIZES = {
  3: { hl: 17, hw: 10.5 }, 4: { hl: 21, hw: 13 }, 5: { hl: 25, hw: 16 },
  7: { hl: 33, hw: 21 }, 9: { hl: 41, hw: 26 }, 11: { hl: 50, hw: 32 },
};
// The live pitch: half length / half width, a scale factor relative to the 5-a-side pitch, and a pace factor for the players.
// Every module reads PITCH at run time, so changing the team size re-shapes the whole game.
export const PITCH = { hl: 25, hw: 16, s: 1, speed: 1 };
export const MATCH = { size: 5 }; // players per team in the current match
export function setPitchForSize(size) {
  size = PITCH_SIZES[size] ? Number(size) : 5;
  const p = PITCH_SIZES[size];
  PITCH.hl = p.hl; PITCH.hw = p.hw;
  PITCH.s = p.hl / 25;
  PITCH.speed = 1 + 0.12 * (PITCH.s - 1);
  MATCH.size = size;
  return PITCH;
}
// Substitutes on the bench for each team size
export const BENCH_SIZES = { 3: 2, 4: 2, 5: 3, 7: 3, 9: 4, 11: 5 };
export const benchSize = (size) => BENCH_SIZES[size] ?? 3;
// Scale a length measured on the 5-a-side pitch to the current pitch (sqrt = grows slower than the pitch itself)
export const sc = (v) => v * PITCH.s;
export const sq = (v) => v * Math.sqrt(PITCH.s);
export const GOAL = { hw: 3.5, h: 2.4, d: 2.4 };
export const BALL_R = 0.3; // radius of the default (size 5) ball

// Standard football sizes (see docs/ball-sizes): real diameter in cm and the age group they are made for.
// The game radius scales with the real diameter, with size 5 = BALL_R.
export const BALL_SIZES = {
  1: { label: 'Size 1', cm: '14', circ: '43 cm', age: 'Mini / skills', d: 14 },
  2: { label: 'Size 2', cm: '16–18', circ: '51–56 cm', age: '4 and under', d: 17 },
  3: { label: 'Size 3', cm: '18–19', circ: '58–61 cm', age: '8 and under', d: 18.5 },
  4: { label: 'Size 4', cm: '20–21', circ: '63.5–66 cm', age: '8–12', d: 20.5 },
  5: { label: 'Size 5', cm: '22–23', circ: '68–70 cm', age: '13+ (standard)', d: 22.5 },
};
export const ballRadius = (size) => BALL_R * (BALL_SIZES[size] || BALL_SIZES[5]).d / BALL_SIZES[5].d;
// The live ball: physics and rendering read BALL.r, so the size can change at any time
export const BALL = { size: 5, r: BALL_R };
export function setBallSize(size) {
  size = BALL_SIZES[size] ? Number(size) : 5;
  BALL.size = size; BALL.r = ballRadius(size);
  return BALL.r;
}

// Teams switch ends at half time: SIDES.flip is -1 in the second half
export const SIDES = { flip: 1 };
// Direction (+1 / -1 along x) in which a team attacks right now
export const attackDir = (team) => (team === 0 ? 1 : -1) * SIDES.flip;
export const REACH = 1.0;
export const GRAVITY = 22;
export const MATCH_TIME = 180;

// CPU skill per level. `assist` is help for the human team (beginners): a larger reach for the ball, so first touches and
// tackles land more easily, on top of a slow, passive CPU. `label` / `blurb` are shown in the menu.
export const DIFFS = {
  kids:     { label: 'Kids', blurb: 'The CPU hardly moves or shoots, your touches are generous', speed: 0.58, react: 1.0, save: 0.12, shootRange: 6, aim: 0.45, tackle: 0.05, assist: 0.5 },
  beginner: { label: 'Beginner', blurb: 'A slow, forgiving CPU; the ball sticks to your feet', speed: 0.68, react: 0.8, save: 0.22, shootRange: 8, aim: 0.34, tackle: 0.1, assist: 0.35 },
  easy:     { label: 'Easy', blurb: 'A relaxed CPU, a little help with the ball', speed: 0.8, react: 0.55, save: 0.38, shootRange: 11, aim: 0.22, tackle: 0.22, assist: 0.15 },
  normal:   { label: 'Normal', blurb: 'The standard game', speed: 0.92, react: 0.32, save: 0.58, shootRange: 14, aim: 0.10, tackle: 0.45, assist: 0 },
  hard:     { label: 'Hard', blurb: 'A fast, clever CPU', speed: 1.0, react: 0.16, save: 0.78, shootRange: 17, aim: 0.04, tackle: 0.70, assist: 0 },
  expert:   { label: 'Expert', blurb: 'A relentless CPU that hardly misses', speed: 1.06, react: 0.1, save: 0.86, shootRange: 19, aim: 0.02, tackle: 0.85, assist: 0 },
};
export const DIFF_KEYS = Object.keys(DIFFS);

export const FORMATION = [
  { role: 'GK',  lx: 1.3,  lz: 0 },
  { role: 'DEF', lx: 13,   lz: 0 },
  { role: 'MID', lx: 23,   lz: -8 },
  { role: 'MID', lx: 23,   lz: 8 },
  { role: 'FWD', lx: 33,   lz: 0 },
];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const angleDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
