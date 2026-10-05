import { clamp } from './constants.js';

// A player's speciality (defending / midfield / attacking share, see teams.js) turns into small skill multipliers.
// A player who is strong in an area is up to ~9% better than average there, a weak one up to ~13% worse;
// playing outside the natural role costs a further 6%.
export const OUT_OF_POSITION = 0.94;
const AREA = { def: 'def', mid: 'mid', att: 'att' };

// The role a player stands in on the pitch compared with his natural one (goalkeepers are never "out of position")
export function outOfPosition(p) {
  const s = p?.spec;
  return !!s && !s.gk && !p.isGK && !!p.role && p.role !== 'GK' && s.main !== p.role;
}

// Multiplier around 1 for 'def' (tackling, clearing headers), 'mid' (passing) or 'att' (shooting power, goal headers)
export function aptitude(p, area) {
  const s = p?.spec;
  if (!s || s.gk) return 1; // keepers are not rated on outfield skills
  const share = s[AREA[area]] ?? 33;
  const v = 0.82 + 0.45 * (share / 100);
  return v * (outOfPosition(p) ? OUT_OF_POSITION : 1) * (p.form ?? 1);
}

// Chance that a slide tackle wins the ball: defenders against attackers nearly always, the other way round about 2 in 3
export function tackleChance(tackler, victim) {
  return clamp(0.86 * aptitude(tackler, 'def') / Math.max(0.8, aptitude(victim, 'mid')), 0.45, 1);
}
