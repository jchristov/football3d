import { PITCH, GOAL, MATCH, clamp, angleDiff, attackDir, sc, sq } from './constants.js';
import { formationOf, pressOf, chasersFor } from './tactics.js';
import { offsideLine } from './offside.js';
import { STYLES } from './styles.js';

const STYLE_BALANCED = STYLES.balanced;

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function runAI(game, dt) {
  for (const team of [0, 1]) teamAI(game, team, dt);
}

function teamAI(game, team, dt) {
  const players = game.teams[team];
  const opp = game.teams[1 - team];
  const d = attackDir(team);
  const diff = game.aiDiff[team];
  const ball = game.ball;
  const own = game.possessionTeam();
  let bp;
  if (ball.pos.y > 0.8 && !ball.held) {
    // lofted ball: run to where it will come down
    const t = Math.min(1.4, (ball.vel.y + Math.sqrt(ball.vel.y * ball.vel.y + 44 * Math.max(0, ball.pos.y - 0.3))) / 22);
    bp = { x: ball.pos.x + ball.vel.x * t * 0.92, z: ball.pos.z + ball.vel.z * t * 0.92 };
  } else bp = { x: ball.pos.x + ball.vel.x * 0.3, z: ball.pos.z + ball.vel.z * 0.3 };

  const sorted = players.filter((p) => !p.isGK && p.stunT <= 0).sort((a, b) => dist(a.pos, bp) - dist(b.pos, bp));
  const press = pressOf(game.tactics[team]);
  const chaser = sorted[0];
  const pressers = sorted.slice(1, chasersFor(press)); // extra players who close the ball carrier down

  for (const p of players) {
    if (game.isHuman(p)) continue;
    const style = game.styles?.[team] || STYLE_BALANCED;
    p.speedMul = diff.speed * press.speed * style.speed;
    p.grip = game.env.physics.grip;
    p.decide -= dt;
    if (p.isGK) { keeperAI(game, p, dt, diff, d); continue; }
    if (game.rules.freezeOutfield) { p.move(0, 0, false, dt); continue; }
    if (p.stunT > 0) { p.move(0, 0, false, dt); continue; }

    const dBall = dist(p.pos, ball.pos);
    if (ball.owner === p && dBall < 1.9 && !ball.held) { carrierAI(game, p, dt, diff, d, players, opp); continue; }

    if (p === chaser && !ball.held) {
      const ow = ball.owner;
      if (ow && ow.team !== team && dBall < 2.0 && p.lungeCd <= 0 && p.decide <= 0) {
        p.decide = diff.react * (0.6 + Math.random() * 0.8);
        const ang = Math.atan2(ball.pos.z - p.pos.z, ball.pos.x - p.pos.x);
        // sensible defenders rarely slide in from behind the carrier
        const behind = Math.abs(angleDiff(ang, ow.facing)) < 0.75;
        if (Math.random() < diff.tackle * press.tackle * (behind ? 0.15 : 0.45) * (p.yellows ? 0.4 : 1) * style.tackle) { p.startLunge(ang); game.sfx.tackle(); } // booked players are careful
      }
      chaseBall(p, ball, bp, d, dt);
    } else if (pressers.includes(p) && own === 1 - team && !ball.held) {
      const gx = -d * PITCH.hl;
      const vx = gx - ball.pos.x, vz = -ball.pos.z;
      const l = Math.hypot(vx, vz) || 1;
      const k = 3 + 2 * pressers.indexOf(p); // the third presser cuts off a wider angle
      p.moveTo(ball.pos.x + (vx / l) * k, ball.pos.z + (vz / l) * k + (pressers.indexOf(p) ? (p.pos.z > ball.pos.z ? 2 : -2) : 0), true, dt);
    } else {
      formationAI(game, p, dt, d, own, players);
    }
  }
}

// Approach a loose ball from behind so the first touch carries it towards goal.
function chaseBall(p, ball, bp, d, dt) {
  const dBall = Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
  if (dBall > 4 || ball.speed > 5 || ball.pos.y > 0.8) { p.moveTo(bp.x, bp.z, true, dt); return; }
  const gx = d * PITCH.hl - ball.pos.x, gz = -ball.pos.z;
  const gl = Math.hypot(gx, gz) || 1;
  const ux = gx / gl, uz = gz / gl;
  const ahead = (ball.pos.x - p.pos.x) * ux + (ball.pos.z - p.pos.z) * uz;
  let tx, tz;
  if (ahead > 0.3) { tx = ball.pos.x + ux * 2; tz = ball.pos.z + uz * 2; }
  else { tx = ball.pos.x - ux * 1.2; tz = ball.pos.z - uz * 1.2; }
  const dx = tx - p.pos.x, dz = tz - p.pos.z, l = Math.hypot(dx, dz) || 1;
  p.move(dx / l, dz / l, true, dt);
}

// Where an outfield player wants to stand given the ball and who has possession
export function formationTarget(game, p, d, own, mates) {
  const ball = game.ball;
  const tac = game.tactics[p.team], F = formationOf(tac), P = pressOf(tac);
  const ballLx = d * ball.pos.x + PITCH.hl;
  let lx = p.home.lx + (ballLx - PITCH.hl) * F.shift + sq(P.line) + sq(game.stateShift?.[p.team] ?? 0);
  if (own === p.team) lx += p.role === 'DEF' ? 3 : 6;
  else if (own === 1 - p.team) lx -= 2;
  lx = clamp(lx, sc(p.role === 'DEF' ? 6 : 9), sc(p.role === 'FWD' ? 46 : 40));
  let lz = p.home.lz * 1.1 + ball.pos.z * 0.3;
  lz = clamp(lz, -PITCH.hw * 0.8, PITCH.hw * 0.8);
  let tx = d * (lx - PITCH.hl), tz = lz;

  for (const m of mates) {
    if (m === p || m.isGK) continue;
    const dd = dist(m.pos, { x: tx, z: tz });
    if (dd < 3.5 && dd > 0.01) { tx += ((tx - m.pos.x) / dd) * (3.5 - dd) * 0.6; tz += ((tz - m.pos.z) / dd) * (3.5 - dd) * 0.6; }
  }
  // with offside on, attackers hold the line instead of waiting beyond the last defender
  if (game.offsideOn && ball.owner !== p) {
    const limit = Math.max(ball.pos.x * d, offsideLine(game.teams[1 - p.team], d)) - 0.7;
    if (tx * d > limit) tx = limit * d;
  }
  return { x: tx, z: tz };
}

function formationAI(game, p, dt, d, own, mates) {
  const t = formationTarget(game, p, d, own, mates);
  const dd = p.moveTo(t.x, t.z, false, dt);
  if (dd < 1) p.faceToward(game.ball.pos.x, game.ball.pos.z, dt);
}

function carrierAI(game, p, dt, diff, d, mates, opp) {
  const style = game.styles?.[p.team] || STYLE_BALANCED;
  const goalX = d * PITCH.hl;
  const gd = Math.hypot(goalX - p.pos.x, p.pos.z);
  let nearest = null, nd = 1e9;
  for (const o of opp) { if (o.isGK) continue; const dd = dist(o.pos, p.pos); if (dd < nd) { nd = dd; nearest = o; } }
  const pressured = nd < 2.6;
  const ownLx = d * p.pos.x + PITCH.hl;
  const reach = sq(1); // distances measured on the 5-a-side pitch grow with the pitch, but more slowly

  p.stuckT = p.speed < 2.2 ? p.stuckT + dt : Math.max(0, p.stuckT - dt * 2);
  if (p.stuckT > 0.7) {
    p.stuckT = 0;
    const alt = mates.filter((m) => m !== p && !m.isGK).sort((a, b) => dist(b.pos, p.pos) - dist(a.pos, p.pos));
    const near = alt.filter((m) => dist(m.pos, p.pos) > 4);
    if (gd < 24 * reach && Math.random() < 0.5) game.aiShoot(p, diff, d);
    else if (near.length && game.passTo(p, near[Math.floor(Math.random() * near.length)], 0.5)) { /* passed */ }
    else game.clear(p, d);
    return;
  }

  if (p.decide <= 0) {
    p.decide = diff.react * (0.5 + Math.random());
    if (gd < diff.shootRange * reach * style.shoot && Math.random() < 0.8) { game.aiShoot(p, diff, d); return; }
    if (Math.abs(p.pos.z) > sc(8) && gd > 7 * reach && gd < 22 * reach && Math.random() < Math.min(0.95, 0.55 * style.lob)) {
      const tgt = mates.find((m) => m !== p && !m.isGK && d * m.pos.x + PITCH.hl > sc(34) && Math.abs(m.pos.z) < sc(6) && dist(m.pos, p.pos) > 6);
      if (tgt && game.lobTo(p, tgt)) return;
    }
    // long-ball teams hoof it forward from their own half when they are not under pressure
    if (!pressured && style.lob > 1.5 && ownLx < sc(30) && Math.random() < 0.35 * (style.lob - 1)) {
      const fwd = mates.find((m) => m !== p && !m.isGK && d * (m.pos.x - p.pos.x) > sc(14) && dist(m.pos, p.pos) < sc(34));
      if (fwd && game.lobTo(p, fwd)) return;
    }
    if (pressured || gd > 24 * reach || style.passFree >= 0.5) {
      const pt = game.bestPass(p, mates, opp, d);
      if (pt && Math.random() < (pressured ? style.passPressed : style.passFree)) { game.passTo(p, pt, 0.9); return; }
    }
    if (pressured && ownLx < sc(12)) { game.clear(p, d); return; }
  }

  let dx = goalX - p.pos.x, dz = -p.pos.z * 0.35;
  let l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const px = -dz, pz = dx;
  let sx = 0, sz = 0;
  for (const o of opp) {
    if (o.isGK) continue;
    const ox = o.pos.x - p.pos.x, oz = o.pos.z - p.pos.z, od = Math.hypot(ox, oz);
    if (od < 4 && ox * dx + oz * dz > 0) {
      const lat = ox * px + oz * pz;
      const k = ((4 - od) / 4) * 1.6 * (lat > 0 ? -1 : 1);
      sx += px * k; sz += pz * k;
    }
  }
  dx += sx; dz += sz;
  if (Math.abs(p.pos.z) > PITCH.hw - 2.5) dz -= Math.sign(p.pos.z) * 0.8;
  l = Math.hypot(dx, dz) || 1;
  p.move(dx / l, dz / l, true, dt);
}

function keeperAI(game, p, dt, diff, d) {
  const ball = game.ball;
  const ownX = -d * PITCH.hl;
  p.speedMul = 1.1 * diff.speed;

  if (ball.held === p) {
    p.move(0, 0, false, dt);
    p.faceToward(p.pos.x + d * 10, p.pos.z, dt);
    p.holdT -= dt;
    if (p.holdT <= 0) game.keeperRelease(p, d);
    return;
  }
  if (p.stunT > 0) { p.move(0, 0, false, dt); return; }

  const depth = (ball.pos.x - ownX) * d;
  let tx = ownX + d * 1.2;
  let tz = clamp(ball.pos.z * 0.3, -2.6, 2.6);
  const towards = -ball.vel.x * d;
  const incoming = towards > 5 && ball.netSide === 0;
  if (incoming) {
    const t = Math.max(0, (depth - 0.3) / towards);
    const zp = ball.pos.z + ball.vel.z * t;
    if (Math.abs(zp) < GOAL.hw + 3) { tz = clamp(zp, -GOAL.hw - 0.2, GOAL.hw + 0.2); tx = ownX + d * 0.9; }
    if (p.diveT <= 0 && t < 0.4 && Math.abs(zp - p.pos.z) > 0.9 && Math.abs(zp) < GOAL.hw + 1) {
      p.diveT = 0.6; p.diveSide = Math.sign(-(zp - p.pos.z) * Math.cos(p.facing)) || 1;
    }
  } else {
    const rival = game.teams[1 - p.team].some((o) => !o.isGK && dist(o.pos, ball.pos) + 1 < dist(p.pos, ball.pos));
    if (depth < 8 && Math.abs(ball.pos.z) < 8 && ball.speed < 6 && !rival && ball.pos.y < 2) { tx = ball.pos.x; tz = ball.pos.z; }
    else if (depth < 12) tx = ownX + d * clamp(depth * 0.18, 1.2, 2.6);
  }
  p.moveTo(tx, tz, true, dt);
  if (!incoming) p.faceToward(ball.pos.x, ball.pos.z, dt); else p.faceToward(p.pos.x + d * 10, p.pos.z, dt);

  const dx = ball.pos.x - p.pos.x, dz = ball.pos.z - p.pos.z, dy = ball.pos.y - 1.0;
  if (p.saveCd <= 0 && ball.netSide === 0 && Math.hypot(dx, dz, dy) < (p.diveT > 0 ? 2.1 : 1.7)) {
    p.saveCd = 0.6;
    p.diveT = 0.6; p.diveSide = Math.sign(dx * Math.sin(p.facing) - dz * Math.cos(p.facing)) || 1;
    const sp = ball.vel.length();
    const fromOpp = ball.owner && ball.owner.team !== p.team;
    let ok;
    if (sp < 8) ok = Math.random() < (fromOpp ? 0.5 : 0.95);
    else ok = Math.random() < diff.save * (1 - Math.min(0.5, (sp - 8) / 40));
    if (ok) {
      if (sp < 15 || Math.random() < 0.4) {
        ball.held = p; ball.owner = p; ball.lastToucher = p;
        p.holdT = 0.9 + Math.random() * 0.8;
      } else {
        ball.vel.set(d * (6 + Math.random() * 4), 3 + Math.random() * 2, (Math.random() - 0.5) * 10);
        ball.owner = null; ball.lastToucher = p;
      }
      game.sfx.save();
      if (sp > 14) game.sfx.ooh();
      ball.spin = 0;
      game.onSave(p, sp);
    }
  }
}
