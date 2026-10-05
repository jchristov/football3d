import { POSE_LEN } from '../player.js';
import { MATCH } from '../constants.js';

// A snapshot is one Float32Array: a fixed header with the match state and the ball, then one block per player.
// The host sends ~30 per second; the guest draws the match from them (see session.js).
export const STATES = ['countdown', 'playing', 'goal', 'foul', 'setpiece', 'sopause', 'replay', 'paused', 'halftime', 'ended', 'menu'];
export const REASONS = ['', 'goal', 'manual', 'best'];
export const HEADER = 32;
export const STRIDE = 6 + POSE_LEN; // x, z, rotation, energy, stamina, flags, pose...

// header slots
const H = { SEQ: 0, STATE: 1, TIMER: 2, CLOCK: 3, HALF: 4, S0: 5, S1: 6, EXCITE: 7, PROGRESS: 8, SP: 9, SPX: 10, SPZ: 11, SPG: 12, SPD: 13, C0: 14, C1: 15, OWNER: 16, HELD: 17, BX: 18, BY: 19, BZ: 20, QX: 21, QY: 22, QZ: 23, QW: 24, SO: 25, GOALDIR: 26, REASON: 27, KICK: 28, N: 29 };

export const FLAG_DEAD = 1, FLAG_INJURED = 2;

const idxOf = (list, p) => (p ? list.indexOf(p) : -1);

// Write the current state of `game` (the host) into a new Float32Array
export function encodeSnapshot(game, seq) {
  const roster = game.roster, n = roster.length;
  const a = new Float32Array(HEADER + n * STRIDE);
  const sp = game.rules.sp, b = game.ball, m = b.mesh;
  a[H.SEQ] = seq;
  a[H.STATE] = Math.max(0, STATES.indexOf(game.state));
  a[H.TIMER] = game.timer || 0; a[H.CLOCK] = game.clock; a[H.HALF] = game.half;
  a[H.S0] = game.score[0]; a[H.S1] = game.score[1];
  a[H.EXCITE] = game.excite || 0;
  a[H.PROGRESS] = game.state === 'replay' ? game.replay.progress : 0;
  a[H.SP] = sp ? (sp.type === 'penalty' ? 1 : 2) : 0;
  if (sp) { a[H.SPX] = sp.S?.x || 0; a[H.SPZ] = sp.S?.z || 0; a[H.SPG] = sp.G?.x || 0; a[H.SPD] = sp.d || 1; }
  a[H.C0] = idxOf(roster, game.ctrls[0]?.player); a[H.C1] = idxOf(roster, game.ctrls[1]?.player);
  a[H.OWNER] = idxOf(roster, b.owner); a[H.HELD] = idxOf(roster, b.held);
  a[H.BX] = m.position.x; a[H.BY] = m.position.y; a[H.BZ] = m.position.z;
  a[H.QX] = m.quaternion.x; a[H.QY] = m.quaternion.y; a[H.QZ] = m.quaternion.z; a[H.QW] = m.quaternion.w;
  a[H.SO] = game.rules.so ? 1 : 0;
  a[H.GOALDIR] = game.lastGoalDir ?? 1;
  a[H.REASON] = Math.max(0, REASONS.indexOf(game.replayReason || ''));
  a[H.KICK] = game.kickTeam ?? 0;
  a[H.N] = n;
  for (let i = 0; i < n; i++) {
    const p = roster[i], o = HEADER + i * STRIDE;
    a[o] = p.mesh.position.x; a[o + 1] = p.mesh.position.z; a[o + 2] = p.mesh.rotation.y;
    a[o + 3] = p.energy; a[o + 4] = p.stamina;
    a[o + 5] = (p.dead ? FLAG_DEAD : 0) | (p.injured ? FLAG_INJURED : 0);
    p.getPose(a, o + 6);
  }
  return a;
}

export function decodeSnapshot(a) {
  if (!(a instanceof Float32Array)) a = new Float32Array(a);
  const n = a[H.N];
  if (a.length !== HEADER + n * STRIDE) return null;
  return {
    a, n, seq: a[H.SEQ], state: STATES[a[H.STATE]] || 'playing', timer: a[H.TIMER], clock: a[H.CLOCK], half: a[H.HALF],
    score: [a[H.S0], a[H.S1]], excite: a[H.EXCITE], progress: a[H.PROGRESS],
    sp: a[H.SP] ? { type: a[H.SP] === 1 ? 'penalty' : 'free', S: { x: a[H.SPX], z: a[H.SPZ] }, G: { x: a[H.SPG], z: 0 }, d: a[H.SPD] } : null,
    ctrl: [a[H.C0], a[H.C1]], owner: a[H.OWNER], held: a[H.HELD],
    ball: { x: a[H.BX], y: a[H.BY], z: a[H.BZ], q: [a[H.QX], a[H.QY], a[H.QZ], a[H.QW]] },
    so: !!a[H.SO], goalDir: a[H.GOALDIR], reason: REASONS[a[H.REASON]] || '', kickTeam: a[H.KICK], at: 0,
  };
}

const lerp = (x, y, t) => x + (y - x) * t;
const lerpAngle = (x, y, t) => x + Math.atan2(Math.sin(y - x), Math.cos(y - x)) * t;

// Put the match on the guest's screen: players, ball and the state fields that the HUD and the camera read.
// `s0` and `s1` are two snapshots and `t` (0..1) the position between them (positions and poses are blended).
export function applySnapshot(game, s0, s1 = s0, t = 0) {
  const roster = game.roster;
  if (!roster.length || s1.n !== roster.length) return false;
  const A = s0.a, B = s1.a;
  let deadChanged = false;
  for (let i = 0; i < roster.length; i++) {
    const p = roster[i], o = HEADER + i * STRIDE;
    const x = lerp(A[o], B[o], t), z = lerp(A[o + 1], B[o + 1], t);
    p.mesh.position.set(x, 0, z);
    p.pos.set(x, 0, z);
    p.mesh.rotation.y = lerpAngle(A[o + 2], B[o + 2], t);
    p.facing = p.mesh.rotation.y;
    p.energy = B[o + 3]; p.stamina = B[o + 4];
    const flags = B[o + 5];
    const dead = !!(flags & FLAG_DEAD);
    if (dead !== !!p.dead) { p.dead = dead; deadChanged = true; }
    p.mesh.visible = !dead;
    p.injured = !!(flags & FLAG_INJURED);
    for (let k = 0; k < POSE_LEN; k++) p.pose[k] = lerp(A[o + 6 + k], B[o + 6 + k], t);
    p.applyPose();
  }
  if (deadChanged) {
    for (let tm = 0; tm < 2; tm++) game.teams[tm] = game.pool[tm].filter((p, i) => i < MATCH.size && !p.dead);
    game.all = [...game.teams[0], ...game.teams[1]];
  }
  const b = game.ball, m = b.mesh;
  const bx = lerp(s0.ball.x, s1.ball.x, t), by = lerp(s0.ball.y, s1.ball.y, t), bz = lerp(s0.ball.z, s1.ball.z, t);
  m.position.set(bx, by, bz);
  b.pos.set(bx, by, bz);
  m.quaternion.set(...s1.ball.q);
  b.owner = s1.owner >= 0 ? roster[s1.owner] : null;
  b.held = s1.held >= 0 ? roster[s1.held] : null;
  return true;
}
