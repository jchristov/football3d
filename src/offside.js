import { PITCH } from './constants.js';

// Offside (optional rule). A team attacks towards `dir` (+1 or -1 along x).
// An attacker is in an offside position when he is in the opponent's half and nearer to the goal line than both
// the ball and the second-last opponent (the keeper counts as one of the opponents).
const MARGIN = 0.15;

export function offsideLine(defenders, dir) {
  // the second-deepest defender towards the goal being attacked
  const xs = defenders.map((p) => p.pos.x * dir).sort((a, b) => b - a);
  return xs.length >= 2 ? xs[1] : xs[0] ?? PITCH.hl;
}

export function isOffsidePosition(p, ballX, defenders, dir) {
  const px = p.pos.x * dir;
  if (px <= MARGIN) return false; // own half
  return px > ballX * dir + MARGIN && px > offsideLine(defenders, dir) + MARGIN;
}

// Snapshot taken when a pass is played: the attackers who were already offside at that moment
export function snapshotOffside(passer, mates, defenders, ballX, dir) {
  const set = new Set();
  for (const m of mates) if (m !== passer && !m.isGK && isOffsidePosition(m, ballX, defenders, dir)) set.add(m);
  return set;
}

// Spot where the free kick is taken: where the offender received the ball, kept inside the pitch
export function offsideSpot(p) {
  return { x: Math.max(-PITCH.hl + 2, Math.min(PITCH.hl - 2, p.pos.x)), z: Math.max(-PITCH.hw + 1.5, Math.min(PITCH.hw - 1.5, p.pos.z)) };
}
