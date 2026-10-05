import * as THREE from 'three';
import { PITCH, GOAL, MATCH, BALL, clamp, angleDiff, attackDir, sc } from './constants.js';
import { formationTarget } from './ai.js';
import { offsideSpot } from './offside.js';
import { settings } from './settings.js';

// Penalty area and wall distance on the current pitch (6 x 14 m and 5.8 m on the 5-a-side pitch)
const box = () => ({ depth: 6 * PITCH.s, hw: 7 * PITCH.s });
const wallDist = () => 5.8 * Math.pow(PITCH.s, 0.7);
const wallSize = () => Math.max(1, Math.round((MATCH.size - 1) / 2.5));

// VAR: the monitor review of penalties and straight red cards (seconds the review takes, and the verdict stays on screen)
export const VAR_TIME = 3.4, VAR_VERDICT = 2;

const RESTART_LABEL = { throw: 'THROW-IN', corner: 'CORNER', goalkick: 'GOAL KICK', free: 'FREE KICK', penalty: 'PENALTY' };

// Fouls, free kicks, penalties and the penalty shoot-out, and the restarts when the ball leaves the pitch.
export class Rules {
  constructor(game) {
    this.g = game;
    this.sp = null;
    this.so = null;
    this.pending = null;
    this.fouls = [0, 0];
    this.varReviews = 0; this.varOverturned = 0; // VAR checks in this match and how many changed the decision
    this.freezeOutfield = false;

    this.aimMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.4, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd21e, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.aimMarker.rotation.y = Math.PI / 2;
    this.aimMarker.renderOrder = 5;
    this.aimMarker.visible = false;
    game.scene.add(this.aimMarker);
  }

  reset() {
    this.sp = null; this.so = null; this.pending = null;
    this.fouls = [0, 0];
    this.varReviews = 0; this.varOverturned = 0;
    this.freezeOutfield = false;
    this.aimMarker.visible = false;
    this.g.hud.setPens(null);
  }

  get active() { return !!this.sp || !!this.so; }

  // ---------- fouls ----------
  // Called for every slide tackle that connects with an opponent. Returns true if it was a foul.
  judgeTackle(tackler, victim) {
    const g = this.g, b = g.ball;
    if (g.state !== 'playing') return false;
    const hadBall = b.owner === victim && Math.hypot(b.pos.x - victim.pos.x, b.pos.z - victim.pos.z) < 2.5;
    let foul, fromBehind = false;
    if (hadBall) {
      // lunging in the same direction the carrier faces means coming from behind
      fromBehind = Math.abs(angleDiff(tackler.lungeAngle, victim.facing)) < 0.75;
      foul = fromBehind && Math.random() < 0.5;
    } else {
      const toBall = Math.hypot(b.pos.x - tackler.pos.x, b.pos.z - tackler.pos.z);
      foul = toBall > 1.7;
    }
    if (foul) this.foul(tackler, victim, { hadBall, fromBehind });
    return foul;
  }

  // A foul from behind on a run at goal (the "last man" foul)
  isDenied(victim, ctx = {}) {
    const goalDist = Math.abs(attackDir(victim.team) * PITCH.hl - victim.pos.x);
    return !!(ctx.hadBall && ctx.fromBehind && goalDist < sc(20));
  }

  // The VAR decision for a penalty / straight red card, or null when there is nothing to check.
  //   margin: metres the foul was inside the penalty area (nearest line); prior: the fouler already has a yellow card.
  // Returns { penalty?: { overturn, restart: 'free' | 'goalkick' }, red?: { overturn } }.
  varVerdict({ card, inBox, margin = 99, ctx = {}, denied = false, prior = false }, rnd = Math.random) {
    const out = {};
    if (inBox) {
      const clear = ctx.hadBall && ctx.fromBehind;
      if (margin < sc(1) && rnd() < 0.6) out.penalty = { overturn: true, restart: 'free', why: 'The contact was outside the box' };
      else if (rnd() < (clear ? 0.07 : 0.3)) out.penalty = { overturn: true, restart: 'goalkick', why: 'No foul, the ball is played' };
      else out.penalty = { overturn: false };
    }
    if (card === 'red') out.red = { overturn: !prior && rnd() < (denied ? 0.15 : 0.4) };
    return out.penalty || out.red ? out : null;
  }

  // The referee's decision about a foul: null (just a free kick), 'yellow', 'second' (second yellow = red) or 'red'.
  // Reckless tackles from behind, fouls in the box, stopping a goal-scoring run and repeat offenders are punished harder.
  judgeCard(fouler, victim, ctx = {}) {
    const g = this.g, L = g.lineups;
    if (g.attract || !L) return null;
    const ft = fouler.team, slot = fouler.squadSlot;
    const prior = L.foulsOf(ft, slot) - 1;
    const denied = this.isDenied(victim, ctx);
    const red = 0.03 + (ctx.hadBall && ctx.fromBehind ? 0.04 : 0) + (denied ? 0.22 : 0);
    const yellow = Math.min(0.9, 0.28 + (ctx.fromBehind ? 0.15 : 0) + (ctx.inBox ? 0.15 : 0) + Math.min(3, prior) * 0.1);
    const r = Math.random();
    let kind = r < red ? 'red' : r < red + yellow ? 'yellow' : null;
    if (kind === 'yellow' && L.yellowsOf(ft, slot) > 0) kind = 'second';
    if ((kind === 'red' || kind === 'second') && !L.canSendOff(ft)) kind = 'yellow'; // the team is already at its minimum
    return kind;
  }

  // A hard challenge can leave the victim hurt: he limps on (slower, no sprints) until he is substituted.
  // Tired players are more at risk; a team loses at most two players to injury per match.
  maybeInjure(victim, chance) {
    const g = this.g, L = g.lineups;
    if (!settings.injuries || g.attract || this.so || !L || victim.injured || victim.dead) return false;
    if (L.injured[victim.team].size >= 2) return false;
    if (Math.random() >= chance * (victim.energy < 0.3 ? 1.6 : 1)) return false;
    g.injure(victim);
    return true;
  }

  // Show the card: yellow cards are recorded at once; a red card takes effect when play restarts
  giveCard(fouler, kind) {
    const g = this.g, L = g.lineups, t = fouler.team;
    if (kind === 'yellow' || kind === 'second') L.book(t, fouler.squadSlot);
    if (kind === 'yellow') g.stats.yellows[t]++;
    if (kind === 'second') { g.stats.yellows[t]++; g.stats.reds[t]++; }
    if (kind === 'red') g.stats.reds[t]++;
    g.stats.recCard(fouler, kind);
    g.comm.card(fouler, kind);
    g.logEvent(kind, t, { name: fouler.name, num: fouler.num });
    g.hud.showCard(kind, `#${fouler.num} ${fouler.name}`, g.teamName(t));
    if (kind !== 'yellow') g.sfx.groan();
  }

  foul(fouler, victim, ctx = {}) {
    const g = this.g;
    if (g.state !== 'playing' || this.so) return;
    const team = 1 - fouler.team;
    const ownGoalX = -attackDir(fouler.team) * PITCH.hl;
    const B = box();
    const inBox = Math.abs(victim.pos.x - ownGoalX) < B.depth && Math.abs(victim.pos.z) < B.hw;
    this.fouls[fouler.team]++;
    g.lineups?.noteFoul(fouler.team, fouler.squadSlot);
    g.stats.recFoul(fouler);
    const card = this.judgeCard(fouler, victim, { ...ctx, inBox });
    const margin = inBox ? Math.min(B.depth - Math.abs(victim.pos.x - ownGoalX), B.hw - Math.abs(victim.pos.z)) : 99;
    const review = settings.var !== false && !g.attract && g.lineups
      ? this.varVerdict({ card, inBox, margin, ctx, denied: this.isDenied(victim, ctx), prior: (g.lineups.yellowsOf(fouler.team, fouler.squadSlot) || 0) > 0 }) : null;
    victim.stunT = Math.max(victim.stunT, 1.2);
    this.maybeInjure(victim, 0.07 + (ctx.fromBehind ? 0.05 : 0));
    fouler.lungeT = 0;
    g.ball.vel.multiplyScalar(0.2);
    g.ball.owner = null;
    this.pending = {
      type: inBox ? 'penalty' : 'free',
      team,
      spot: { x: clamp(victim.pos.x, -PITCH.hl + 1.5, PITCH.hl - 1.5), z: clamp(victim.pos.z, -PITCH.hw + 1.5, PITCH.hw - 1.5) },
      sendOff: card === 'red' || card === 'second' ? fouler : null,
      fouler, victim, card, review,
    };
    g.state = 'foul';
    g.timer = card ? 2.8 : 1.7;
    g.sfx.whistle();
    g.sfx.groan();
    if (review) {
      // the referee points to the monitor; card and penalty are confirmed (or not) when the review is over
      g.timer = VAR_TIME;
      const what = [review.penalty && 'penalty', review.red && 'red card'].filter(Boolean).join(' and ');
      g.comm.varCheck(what);
      g.hud.showVar('check', `Possible ${what}`, VAR_TIME);
      if (card && !review.red) this.giveCard(fouler, card);
    } else {
      g.comm.foul(fouler, victim, inBox);
      if (inBox) g.logEvent('pen', team, { name: fouler.name });
      g.hud.setBanner('FOUL!', inBox ? 'Penalty!' : `Free kick · ${g.teamCode(team)}`, card ? 2600 : 1600);
      if (card) this.giveCard(fouler, card);
    }
    g.excite = Math.max(g.excite, card ? 0.5 : 0.25);
  }

  // ---------- the ball leaves the pitch ----------
  // Over a touchline: throw-in for the team that did not touch it last. Over a goal line outside the goal: a goal kick if an
  // attacker touched it last, otherwise a corner for the attackers. Play restarts through the normal set-piece machinery.
  checkOut() {
    const g = this.g, b = g.ball, R = BALL.r;
    if (g.state !== 'playing' || this.so || b.held || b.netSide !== 0) return false;
    const lt = b.lastToucher;
    let type = null, team = -1, spot = null;
    if (Math.abs(b.pos.z) > PITCH.hw + R) {
      type = 'throw'; team = lt ? 1 - lt.team : (b.pos.x > 0 ? 0 : 1);
      spot = { x: clamp(b.pos.x, -PITCH.hl + 2, PITCH.hl - 2), z: Math.sign(b.pos.z) * (PITCH.hw - 0.5) };
    } else if (Math.abs(b.pos.x) > PITCH.hl + R) {
      if (Math.abs(b.pos.z) < GOAL.hw && b.pos.y < GOAL.h) return false; // in the goal
      const sx = Math.sign(b.pos.x), attackers = attackDir(0) === sx ? 0 : 1, last = lt ? lt.team : attackers;
      if (last === attackers) { type = 'goalkick'; team = 1 - attackers; spot = { x: sx * (PITCH.hl - 5 * PITCH.s), z: 0 }; }
      else { type = 'corner'; team = attackers; spot = { x: sx * (PITCH.hl - 0.6), z: Math.sign(b.pos.z || 1) * (PITCH.hw - 0.6) }; g.stats.corners[team]++; }
    }
    if (!type) return false;
    b.vel.multiplyScalar(0.1); b.owner = null;
    this.pending = { type, team, spot };
    g.state = 'foul';
    g.timer = 0.9;
    g.comm.restart(type, team);
    g.hud.setBanner(RESTART_LABEL[type], g.teamCode(team), 900);
    return true;
  }

  // An attacker received a pass from an offside position: indirect free kick for the defenders
  offside(p) {
    const g = this.g;
    if (g.state !== 'playing' || this.so) return;
    const team = 1 - p.team;
    g.stats.offsides[p.team]++;
    g.ball.vel.multiplyScalar(0.2);
    g.ball.owner = null;
    this.pending = { type: 'free', team, spot: offsideSpot(p) };
    g.state = 'foul';
    g.timer = 1.6;
    g.sfx.whistle();
    g.comm.offside(p);
    g.hud.setBanner('OFFSIDE!', `${p.name} · free kick ${g.teamCode(team)}`, 1500);
  }

  // The end of the VAR review: apply the verdict to the penalty and the card, announce it, and give the verdict some time on screen
  resolveVar(pd) {
    const g = this.g, rv = pd.review, F = pd.fouler;
    const notes = [];
    if (rv.penalty) {
      if (rv.penalty.overturn) {
        const own = -attackDir(F.team) * PITCH.hl, B = box();
        if (rv.penalty.restart === 'goalkick') { pd.type = 'goalkick'; pd.team = F.team; pd.spot = { x: Math.sign(own) * (PITCH.hl - 5 * PITCH.s), z: 0 }; notes.push('No penalty · goal kick'); }
        else { pd.type = 'free'; pd.spot = { x: own + Math.sign(-own) * (B.depth + 0.5), z: clamp(pd.spot.z, -PITCH.hw + 1.5, PITCH.hw - 1.5) }; notes.push('Not a penalty · free kick outside the box'); }
        notes.push(rv.penalty.why);
      } else {
        notes.push('Penalty stands');
        g.logEvent('pen', pd.team, { name: F.name });
      }
    }
    if (rv.red) {
      if (rv.red.overturn) { pd.card = 'yellow'; notes.push('Red card reduced to a yellow'); } else notes.push('Red card stands');
      this.giveCard(F, pd.card);
      pd.sendOff = pd.card === 'red' ? F : null;
    }
    rv.done = true;
    const changed = (rv.penalty?.overturn) || (rv.red?.overturn);
    this.varReviews++;
    if (changed) this.varOverturned++;
    g.logEvent('var', pd.team, { text: notes[0], changed: !!changed });
    g.comm.varVerdict(!!changed, notes[0]);
    g.hud.showVar(changed ? 'changed' : 'stands', notes.join(' · '), VAR_VERDICT);
    g.timer = VAR_VERDICT;
  }

  updateFoul(dt) {
    const g = this.g;
    for (const p of g.all) { p.tick(dt); p.move(0, 0, false, dt); }
    g.ball.step(dt);
    g.timer -= dt;
    if (g.timer <= 0 && this.pending?.review && !this.pending.review.done) { this.resolveVar(this.pending); return; }
    if (g.timer <= 0 && this.pending) {
      const { type, team, spot, sendOff } = this.pending;
      this.pending = null;
      if (sendOff && !sendOff.dead) g.sendOff(sendOff);
      this.startSetPiece(type, team, spot);
    }
  }

  // ---------- set pieces ----------
  startSetPiece(type, team, spot, opts = {}) {
    const g = this.g, d = attackDir(team);
    const G = { x: d * PITCH.hl, z: 0 };
    let S = spot;
    const Sc = PITCH.s, Sq = Math.sqrt(PITCH.s);
    if (type === 'penalty') S = { x: G.x - d * 4.5 * Sc, z: 0 };
    else if (type === 'free' && Math.hypot(G.x - S.x, G.z - S.z) < 5 * Sc) S = { x: G.x - d * 5 * Sc, z: S.z };
    let ux = G.x - S.x, uz = G.z - S.z;
    const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;

    g.ball.reset(S.x, S.z);
    const atk = g.teams[team], def = g.teams[1 - team];
    const outfield = (list) => list.filter((p) => !p.isGK);
    const ctrl = type === 'goalkick' ? null : g.ctrlOf(team); // the keeper takes goal kicks, always by the CPU

    // kicker: human's nearest player, else the nearest AI player (penalties: the forward)
    const byDist = (list) => [...list].sort((a, b) => Math.hypot(a.pos.x - S.x, a.pos.z - S.z) - Math.hypot(b.pos.x - S.x, b.pos.z - S.z));
    let kicker = (type === 'penalty' && atk.find((p) => p.role === 'FWD')) || byDist(outfield(atk))[0];
    if (opts.shootout) kicker = outfield(atk)[Math.floor(this.so.order / 2) % outfield(atk).length];
    if (type === 'goalkick') kicker = atk[0];

    const used = new Set([kicker]);
    kicker.place(S.x - ux * 1.3, S.z - uz * 1.3, Math.atan2(uz, ux));

    if (type === 'penalty') {
      // everyone else waits outside the box, facing the spot
      const line = (list, baseX, shiftZ) => {
        outfield(list).filter((p) => !used.has(p)).forEach((p, i) => {
          const z = shiftZ + (i % 2 ? 1 : -1) * (3 + Math.floor(i / 2) * 3);
          const x = G.x - d * (baseX + (i % 2) * 0.5);
          p.place(x, z, Math.atan2(S.z - z, S.x - x));
          used.add(p);
        });
      };
      line(atk, 8.4 * Sc, 0);
      line(def, 10.2 * Sc, 1.5);
      def[0].place(G.x - d * 1.0, 0, d > 0 ? Math.PI : 0);
      atk[0].place(-d * (PITCH.hl - 1.3), 0, d > 0 ? 0 : Math.PI);
    } else {
      if (atk[0] !== kicker) atk[0].place(-d * (PITCH.hl - 1.3), 0, d > 0 ? 0 : Math.PI);
      def[0].place(G.x - d * 1.0, 0, d > 0 ? Math.PI : 0);
      const perp = { x: -uz, z: ux };
      let wallers = [];
      const wn = wallSize();
      if (type === 'free' && Math.hypot(G.x - S.x, G.z - S.z) < 30 * Sq) wallers = byDist(outfield(def)).slice(0, wn);
      wallers.forEach((p, i) => {
        const off = (i - (wallers.length - 1) / 2) * 1.1;
        p.place(S.x + ux * wallDist() + perp.x * off, S.z + uz * wallDist() + perp.z * off, Math.atan2(-uz, -ux));
        used.add(p);
      });
      for (const [list, dir, own] of [[atk, d, team], [def, -d, team]]) {
        for (const p of outfield(list)) {
          if (used.has(p)) continue;
          const t = formationTarget(g, p, dir, own, list);
          let { x, z } = t;
          if (list === def) {
            const dx = x - S.x, dz = z - S.z, dd = Math.hypot(dx, dz);
            const keep = 7 * Sq;
            if (dd < keep) { x = S.x + (dx / (dd || 1)) * keep; z = S.z + (dz / (dd || 1)) * keep; }
          }
          p.place(clamp(x, -PITCH.hl + 1, PITCH.hl - 1), clamp(z, -PITCH.hw + 1, PITCH.hw - 1), Math.atan2(S.z - z, S.x - x));
          used.add(p);
        }
      }
    }

    if (ctrl) { ctrl.reset(); ctrl.player = kicker; }
    for (const c of g.ctrls) if (c !== ctrl) c.reset();
    const home = { x: S.x - ux * 1.3, z: S.z - uz * 1.3, a: Math.atan2(uz, ux) }; // where the kicker waits behind the ball
    this.sp = { type, team, S, G, d, kicker, ctrl, home, t: 0, shootout: !!opts.shootout, aiDelay: 1.3 + Math.random() * 0.9 };
    g.state = 'setpiece';
    g.timer = 0;
    if (type === 'free' || type === 'penalty') g.comm.stepsUp(kicker, !!opts.shootout);
    if (!this.so && (type === 'free' || type === 'penalty')) g.hud.setBanner(RESTART_LABEL[type], g.teamCode(team), 1500);
    if (type === 'free' || type === 'penalty') g.sfx.whistle();
  }

  updateSetPiece(dt) {
    const g = this.g, sp = this.sp;
    if (!sp) { g.state = 'playing'; return; }
    sp.t += dt;
    const k = sp.kicker;
    for (const p of g.all) {
      p.tick(dt);
      if (p === k) continue;
      p.move(0, 0, false, dt);
      if (p.isGK && p.team !== sp.team && sp.type === 'penalty') p.faceToward(p.pos.x - sp.d * 10, p.pos.z, dt);
      else if (!p.isGK) p.faceToward(sp.S.x, sp.S.z, dt);
    }
    g.ball.step(dt);

    const ready = sp.t > 1.1;
    const penaltyHuman = sp.type === 'penalty' && sp.ctrl;
    this.aimMarker.visible = !!penaltyHuman && ready;
    if (penaltyHuman) {
      this.aimMarker.position.set(sp.G.x + sp.d * 0.15, 1.15, sp.ctrl.aimZ);
    }

    if (ready) {
      if (sp.ctrl && sp.t < 16) {
        if (sp.type === 'penalty') sp.ctrl.updatePenalty(dt, k);
        else { sp.ctrl.update(dt); g.contacts(); }
      } else {
        k.move(0, 0, false, dt);
        if (sp.t > 1.1 + sp.aiDelay || sp.ctrl) this.aiTake();
      }
    } else k.move(0, 0, false, dt);

    if (g.ball.speed > 1.2 || g.ball.pos.y > 0.6) this.release();
  }

  release() {
    const g = this.g, sp = this.sp;
    this.aimMarker.visible = false;
    if (sp.ctrl) sp.ctrl.player.charge = 0;
    const kicker = sp.kicker;
    this.sp = null;
    g.state = 'playing';
    g.hud.hideBanner();
    if (this.so) { this.so.kicker = kicker; this.so.live = true; this.so.kt = 0; this.so.saved = false; }
    g.deadT = 0;
  }

  aiTake() {
    const g = this.g, sp = this.sp, k = sp.kicker, d = sp.d;
    if (!g.canKick(k) && !this.recall(sp)) return;
    const diff = g.aiDiff[sp.team];
    if (sp.type === 'throw' || sp.type === 'corner' || sp.type === 'goalkick') { this.aiRestart(sp, k, d, diff); return; }
    if (sp.type === 'penalty') {
      const side = Math.random() < 0.5 ? -1 : 1;
      const tz = side * (1.9 + Math.random() * 1.2);
      const jitter = (Math.random() - 0.5) * diff.aim * 1.4;
      g.doKick(k, Math.atan2(tz - k.pos.z, sp.G.x - k.pos.x) + jitter, 17.5 + Math.random() * 5, 0.3 + Math.random() * 1.1, 0, 'shot');
    } else if (Math.hypot(sp.G.x - sp.S.x, sp.G.z - sp.S.z) < 22 * Math.sqrt(PITCH.s)) g.aiShoot(k, diff, d);
    else {
      const mates = g.teams[sp.team], opp = g.teams[1 - sp.team];
      const t = g.bestPass(k, mates, opp, d);
      if (t && !g.lobTo(k, t)) g.passTo(k, t, 1);
      else if (!t) g.clear(k, d);
    }
  }

  // The kicker (a human who wandered off, or one who is still lying stunned) must not hold the game up for ever: after the
  // waiting time he is put back behind the ball, and the ball back on its spot, so that the kick can be taken. Returns whether he can kick now.
  recall(sp) {
    const g = this.g, k = sp.kicker;
    const b = g.ball;
    if (b.held || Math.hypot(b.pos.x - sp.S.x, b.pos.z - sp.S.z) > 0.5 || b.pos.y > 0.6) b.reset(sp.S.x, sp.S.z);
    k.place(sp.home.x, sp.home.z, sp.home.a);
    return g.canKick(k);
  }

  // The CPU takes a throw-in (short pass), a corner (lob into the box) or a goal kick (the keeper boots it upfield)
  aiRestart(sp, k, d, diff) {
    const g = this.g, mates = g.teams[sp.team].filter((m) => m !== k && !m.isGK), opp = g.teams[1 - sp.team];
    const near = (m) => Math.hypot(m.pos.x - k.pos.x, m.pos.z - k.pos.z);
    if (sp.type === 'throw') {
      const t = g.bestPass(k, g.teams[sp.team], opp, d) || [...mates].sort((a, b) => near(a) - near(b))[0];
      if (t) g.passTo(k, t, 1, 1.2); else g.clear(k, d);
    } else if (sp.type === 'corner') {
      // the team-mate closest to the goal mouth
      const t = [...mates].sort((a, b) => Math.hypot(a.pos.x - sp.G.x, a.pos.z) - Math.hypot(b.pos.x - sp.G.x, b.pos.z))[0];
      if (t && !g.lobTo(k, t)) g.passTo(k, t, 1, 2);
      else if (!t) g.clear(k, d);
    } else {
      const fwd = [...mates].sort((a, b) => d * (b.pos.x - a.pos.x))[0];
      if (fwd && !g.lobTo(k, fwd)) g.clear(k, d);
      else if (!fwd) g.clear(k, d);
    }
  }

  // Human penalty: aim with left/right, charge for power; a full bar is skied over the bar
  penaltyShot(k, aimZ, charge) {
    const g = this.g, sp = this.sp;
    if (!sp || !g.canKick(k)) return;
    const over = charge >= 0.98;
    const angle = Math.atan2(aimZ - k.pos.z, sp.G.x - k.pos.x) + (over ? (Math.random() - 0.5) * 0.1 : 0);
    g.doKick(k, angle, 12 + 12 * charge, over ? 7 : 0.3 + 1.8 * charge, 0, 'shot');
  }

  // ---------- penalty shoot-out ----------
  startShootout() {
    const g = this.g;
    this.so = { order: 0, kicks: [[], []], pens: [0, 0], live: false, kt: 0, saved: false, timer: 0, winner: null };
    this.freezeOutfield = true;
    g.hud.hideBanner();
    g.hud.setBanner('SHOOT-OUT', 'Penalties decide it', 2200);
    g.state = 'sopause';
    g.timer = 2.4;
    this.so.next = true;
    for (const p of g.all) p.celebrate = false;
    g.hud.setPens(this.so.kicks);
  }

  nextKick() {
    const so = this.so, g = this.g;
    const team = so.order % 2;
    so.next = false;
    this.startSetPiece('penalty', team, null, { shootout: true });
    g.hud.setBanner(`${g.teamCode(team)} to shoot`, `Kick ${Math.floor(so.order / 2) + 1}`, 1400);
  }

  updatePause(dt) {
    const g = this.g, so = this.so;
    for (const p of g.all) { p.tick(dt); p.move(0, 0, false, dt); }
    g.ball.step(dt);
    g.timer -= dt;
    if (g.timer > 0) return;
    if (so.winner !== null) { g.finishMatch(so.winner, [...so.pens]); return; }
    this.nextKick();
  }

  liveUpdate(dt) {
    const so = this.so, b = this.g.ball;
    if (!so || !so.live) return;
    so.kt += dt;
    if (so.saved) this.shootoutResult(false, 'SAVED!');
    else if ((so.kt > 0.9 && b.speed < 1.3 && b.pos.y < 0.6) || so.kt > 4.5) this.shootoutResult(false, 'MISSED!');
  }

  shootoutResult(scored, label) {
    const g = this.g, so = this.so;
    if (!so || !so.live) return;
    so.live = false;
    const team = so.order % 2;
    so.kicks[team].push(scored);
    if (scored) so.pens[team]++;
    so.order++;
    g.hud.setPens(so.kicks);
    if (so.kicker) g.comm.penaltyResult(so.kicker, scored, scored ? null : g.teams[1 - team][0]);
    const [na, nb] = [so.kicks[0].length, so.kicks[1].length];
    const [a, b] = so.pens;
    if (na <= 5 && nb <= 5) {
      if (a > b + (5 - nb)) so.winner = 0; else if (b > a + (5 - na)) so.winner = 1;
    }
    if (na === nb && na >= 5 && a !== b) so.winner = a > b ? 0 : 1;
    if (scored) { g.sfx.cheer(); g.world.confetti.burst(g.ball.pos.x, 0); g.teams[team].forEach((p) => (p.celebrate = true)); }
    else g.sfx.groan();
    g.hud.setBanner(label || 'GOAL!', `${so.pens[0]} - ${so.pens[1]}`, 1900);
    g.state = 'sopause';
    g.timer = 2.3;
    so.next = true;
    for (const p of g.all) if (p.team !== team) p.celebrate = false;
  }
}
