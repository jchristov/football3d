import { settings, saveSettings, onSettings } from './settings.js';

const title = (s) => s.charAt(0) + s.slice(1).toLowerCase();
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Live text commentary: reacts to match events with a few varied lines each.
export class Commentary {
  constructor(game, hud) {
    this.game = game;
    this.hud = hud;
    this.enabled = settings.commentary !== false;
    this.until = 0; this.last = -99; this.prio = 0;
    this.timeMarks = new Set();
    this.nextPossCheck = 30;
    onSettings((s) => { this.enabled = s.commentary !== false; if (!this.enabled) { this.hud.showCommentary(''); this.game.speech?.stop(); } });
  }

  toggle() {
    this.enabled = !this.enabled;
    settings.commentary = this.enabled;
    saveSettings();
    if (!this.enabled) { this.hud.showCommentary(''); this.game.speech?.stop(); }
    this.hud.toast(this.enabled ? 'COMMENTARY ON' : 'COMMENTARY OFF');
  }

  reset() { this.timeMarks.clear(); this.nextPossCheck = 30; this.until = 0; this.prio = 0; this.hud.showCommentary(''); }

  say(text, prio = 1, hold = 3.6) {
    const g = this.game;
    if (!this.enabled || g.attract) return;
    const now = g.time;
    if (now < this.until && prio < this.prio) return;
    if (prio <= 1 && now - this.last < 2.4) return;
    this.last = now; this.prio = prio; this.until = now + hold;
    this.hud.showCommentary(text);
    g.speech?.speak(text, prio);
  }

  update() {
    if (this.game.time > this.until && this.prio !== 0) { this.prio = 0; this.hud.showCommentary(''); }
  }

  // ----- events -----
  // The stadium announcer speaks (no caption); the commentator's lines come first
  announce(text) {
    const g = this.game;
    if (g.attract) return;
    g.speech?.announce(text);
  }

  kickoff() {
    const g = this.game;
    const cap = (t) => { const L = g.lineups, p = g.teams[t].find((x) => x.captain); return p ? `captain number ${p.num}, ${title(p.name)}` : ''; };
    this.announce(`Ladies and gentlemen, welcome! Today: ${g.teamName(0)} against ${g.teamName(1)}. ${g.teamName(0)} are led by ${cap(0)}. ${g.teamName(1)} are led by ${cap(1)}.`);
    this.say(`${g.teamName(0)} v ${g.teamName(1)} — and we are underway!`, 3, 4);
  }

  goal(team, scorer, own, score) {
    const g = this.game, n = title(scorer ? scorer.name : 'Someone');
    const [a, b] = score, mine = team === 0 ? a : b, theirs = team === 0 ? b : a;
    const tn = g.teamName(team);
    let l;
    if (own) l = `Oh no! ${n} puts it into his own net!`;
    else if (a + b === 1) l = pick([`${n} breaks the deadlock!`, `${n} scores the opener for ${tn}!`]);
    else if (mine === theirs) l = pick([`${n} equalises! ${tn} are level at ${a}-${b}!`, `All square! ${n} levels it!`]);
    else if (mine === theirs + 1) l = pick([`${n} puts ${tn} ahead! ${a}-${b}!`, `${tn} take the lead through ${n}!`]);
    else l = pick([`${n} extends the lead! ${a}-${b}.`, `Another for ${tn}! ${n} makes it ${a}-${b}.`]);
    this.say('⚽ ' + l, 5, 4.5);
    this.announce(own ? `Own goal, by number ${scorer?.num || ''}, ${n}. ${g.teamName(0)} ${a}, ${g.teamName(1)} ${b}.` : `Goal for ${tn}! Scored by number ${scorer?.num || ''}, ${n}. ${g.teamName(0)} ${a}, ${g.teamName(1)} ${b}.`);
  }

  shot(p, info) {
    const n = title(p.name);
    if (info.onTarget) this.say(pick([`${n} lets fly!`, `${n} tries his luck!`, `A powerful strike from ${n}!`]), 2, 2.6);
    else this.say(pick([`${n} drags it wide.`, `${n} fires off target.`, `${n} goes for goal — wide of the post.`]), 1, 2.4);
  }

  save(gk, hard) { this.say(hard ? pick([`Great save by ${title(gk.name)}!`, `Superb stop from ${title(gk.name)}!`]) : `${title(gk.name)} gathers it safely.`, hard ? 3 : 1, 2.8); }
  post(p) { this.say(pick(['Off the woodwork! So close!', 'It rattles the post!', 'Agonisingly close — it hits the frame!']), 3, 2.8); }
  header(p, atGoal) { this.say(atGoal ? `${title(p.name)} with a powerful header!` : pick([`${title(p.name)} wins the header.`, `${title(p.name)} gets up well.`]), atGoal ? 3 : 1, 2.4); }
  volley(p) { this.say(`What a volley from ${title(p.name)}!`, 3, 2.6); }
  curler(p) { this.say(`${title(p.name)} bends it towards the far post!`, 3, 2.8); }
  cross(p) { this.say(`${title(p.name)} swings in a cross.`, 1, 2.2); }
  tackle(p) { this.say(pick([`Crunching tackle from ${title(p.name)}!`, `${title(p.name)} wins it back.`]), 2, 2.4); }

  foul(f, v, penalty) {
    const g = this.game;
    this.say(penalty ? `PENALTY! ${title(f.name)} brings down ${title(v.name)} in the box!` : `Foul by ${title(f.name)} on ${title(v.name)}. Free kick to ${g.teamName(v.team)}.`, 4, 3.6);
  }
  card(p, kind) {
    const g = this.game, n = title(p.name), tn = g.teamName(p.team);
    const lines = {
      yellow: [`Yellow card for ${n}. The referee has seen enough.`, `${n} goes into the book.`],
      second: [`A second yellow! ${n} is sent off, ${tn} are down to ten!`, `Two yellows, and ${n} must go!`],
      red: [`Straight red! ${n} is sent off!`, `Red card! ${n} walks, ${tn} will be a man short!`],
    }[kind];
    this.say(pick(lines), 4, 3.8);
    this.announce(`${{ yellow: 'Yellow card', second: 'A second yellow card, and a red', red: 'Red card' }[kind]} for number ${p.num}, ${n}, of ${tn}.`);
  }
  varCheck(what) {
    this.say(`The referee signals for a VAR check: a possible ${what}.`, 4, 3.4);
    this.announce(`Video assistant referee check. Possible ${what}.`);
  }
  varVerdict(changed, text) {
    this.say(changed ? `VAR has overturned it! ${text}.` : `VAR confirms the decision. ${text || ''}`, 4, 3.4);
    this.announce(changed ? `Decision overturned. ${text}.` : 'The referee decision stands.');
  }
  injury(p) { this.say(`${title(p.name)} is down and looks hurt. ${this.game.teamName(p.team)} may have to make a change.`, 4, 3.6); }
  restart(type, team) {
    const tn = this.game.teamName(team);
    this.say({ throw: `Throw-in for ${tn}.`, corner: `Corner kick for ${tn}!`, goalkick: `Goal kick for ${tn}.` }[type], 1, 2.2);
  }
  keeperOn(team, m) { this.say(`${title(m.name)} puts on the gloves for ${this.game.teamName(team)}.`, 3, 3); }
  offside(p) { this.say(`Flag is up! ${title(p.name)} was in an offside position.`, 4, 3.2); }
  sub(team, out, inn) {
    const g = this.game;
    this.say(`Substitution for ${g.teamName(team)}: ${title(inn.name)} comes on for ${title(out.name)}.`, 2, 3.4);
    this.announce(`Substitution for ${g.teamName(team)}. Number ${inn.num}, ${title(inn.name)}, replaces number ${out.num}, ${title(out.name)}.`);
  }
  stepsUp(p, shootout) { this.say(`${title(p.name)} steps up to take the ${shootout ? 'penalty' : 'free kick'}.`, 3, 2.8); }
  penaltyResult(p, scored, gk) { this.say(scored ? pick([`${title(p.name)} scores from the spot!`, `Cool finish by ${title(p.name)}!`]) : (gk ? `Saved by ${title(gk.name)}!` : `${title(p.name)} misses!`), 4, 3); }
  replay() { this.say("Let's take another look at that.", 3, 3); }
  fullTime(msg) {
    this.say(`Full time! ${msg}`, 5, 8);
    const g = this.game;
    this.announce(`Full time. The final score: ${g.teamName(0)} ${g.score[0]}, ${g.teamName(1)} ${g.score[1]}.`);
  }

  halftime(score) {
    const g = this.game, [a, b] = score;
    const line = a === b ? `Half time! All square, ${a} ${b}.` : `Half time! ${g.teamName(a > b ? 0 : 1)} lead ${Math.max(a, b)} ${Math.min(a, b)}.`;
    this.say(line, 5, 6);
    this.announce(`Half time. ${g.teamName(0)} ${a}, ${g.teamName(1)} ${b}.`);
  }
  secondHalf() { this.say(`We are back for the second half. The teams have switched ends and ${this.game.teamName(1)} kick off.`, 5, 5); }

  tick(clock, length) {
    const g = this.game;
    if (g.attract || g.rules.so) return;
    const half = g.half, halfLen = length / 2;
    const left = half === 1 ? clock - halfLen : clock;
    const marks = half === 1
      ? [[30, 'Thirty seconds left in the first half.'], [10, 'The first half is nearly over.']]
      : [[60, 'One minute to go.'], [30, 'Thirty seconds left on the clock.'], [10, 'Final seconds!']];
    for (const [sec, line] of marks) {
      const key = `${half}-${sec}`;
      if (left <= sec && halfLen > sec * 1.5 && !this.timeMarks.has(key)) { this.timeMarks.add(key); this.say(line, 2, 3); }
    }
    const played = length - clock;
    if (played > this.nextPossCheck) {
      this.nextPossCheck += 30;
      const [a, b] = g.stats.possession();
      const hi = Math.max(a, b);
      if (hi >= 65) this.say(`${g.teamName(a > b ? 0 : 1)} are dominating possession — ${hi}% of the ball.`, 1, 3.4);
    }
  }
}
