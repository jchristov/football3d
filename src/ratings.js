// Match ratings: every player who played gets a mark from 3.0 to 10.0 built from what he did in the match
// (goals, assists, shots, passing, tackles, saves, discipline) plus the team result.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const BASE_RATING = 6;

export function rate(r, { won = false, lost = false, conceded = 0, minutesShare = 1 } = {}) {
  let v = BASE_RATING;
  v += r.goals * 1.2 + r.assists * 0.8 + r.onTarget * 0.15;
  v += clamp((r.passesOk - (r.passes - r.passesOk) * 0.6) * 0.03, -0.5, 0.6);
  v += r.tackles * 0.3 + r.saves * 0.4 + r.headers * 0.1;
  v -= r.fouls * 0.25 + r.yellows * 0.5 + r.reds * 1.5 + r.ownGoals * 1.5;
  if (won) v += 0.4; else if (lost) v -= 0.3;
  if (conceded === 0 && (r.role === 'GK' || r.role === 'DEF')) v += 0.5;
  if (r.role === 'GK') v -= conceded * 0.25;
  // a short appearance moves the mark less far from the base
  v = BASE_RATING + (v - BASE_RATING) * clamp(0.4 + minutesShare * 0.6, 0.4, 1);
  return Math.round(clamp(v, 3, 10) * 10) / 10;
}

// stats: Stats instance, score: [home, away], matchSeconds: the length that was played
export function computeRatings(stats, score, matchSeconds) {
  const out = [];
  for (const r of stats.players.values()) {
    if (r.seconds < 1) continue;
    const mine = score[r.team], theirs = score[1 - r.team];
    const rating = rate(r, { won: mine > theirs, lost: mine < theirs, conceded: theirs, minutesShare: clamp(r.seconds / Math.max(1, matchSeconds), 0, 1) });
    out.push({ ...r, rating });
  }
  return out.sort((a, b) => b.rating - a.rating || b.goals - a.goals);
}

// The best player of the winning side (or of the match when it is a draw)
export function manOfTheMatch(ratings, score) {
  if (!ratings.length) return null;
  const winner = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : -1;
  const pool = winner >= 0 ? ratings.filter((r) => r.team === winner) : ratings;
  return (pool.length ? pool : ratings)[0];
}
