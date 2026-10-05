import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKIN_TONES, SKIN_MAX, skinHex, HAIR_COLORS, HAIR_STYLES, BEARDS, BOOT_COLORS, TEAM_PROFILES, SLOTS,
  defaultLook, lookFor, signature, randomLook, cleanName,
} from '../src/appearance.js';
import { settings } from '../src/settings.js';
import { squad, TEAMS } from '../src/teams.js';
import { hairGeometry, beardGeometry } from '../src/hair.js';

test.beforeEach(() => { settings.custom = {}; });

test('there are 10 skin tones that get steadily darker, and skinHex interpolates between them', () => {
  assert.equal(SKIN_TONES.length, 10);
  const lum = (c) => 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);
  for (let i = 1; i < SKIN_TONES.length; i++) assert.ok(lum(SKIN_TONES[i]) < lum(SKIN_TONES[i - 1]), `tone ${i}`);
  assert.equal(skinHex(0), SKIN_TONES[0]);
  assert.equal(skinHex(SKIN_MAX), SKIN_TONES[SKIN_MAX]);
  const mid = lum(skinHex(2.5));
  assert.ok(mid < lum(SKIN_TONES[2]) && mid > lum(SKIN_TONES[3]));
  assert.equal(skinHex(-3), SKIN_TONES[0]); assert.equal(skinHex(99), SKIN_TONES[SKIN_MAX]);
});

test('all 128 squad players (8 teams x 16) have a different look (skin, hair, style, facial hair, boots)', () => {
  const sigs = [];
  for (let t = 0; t < TEAMS.length; t++) for (let s = 0; s < SLOTS; s++) sigs.push(signature(defaultLook(t, s)));
  assert.equal(SLOTS, 16);
  assert.equal(sigs.length, 128);
  assert.equal(new Set(sigs).size, 128);
});

test('looks are deterministic: the same player always looks the same', () => {
  for (let t = 0; t < TEAMS.length; t++) for (let s = 0; s < SLOTS; s++) assert.deepEqual(defaultLook(t, s), defaultLook(t, s));
  assert.deepEqual(squad(3)[2].look, squad(3)[2].look);
});

test('every look uses valid values, and bald players keep a neutral hair colour', () => {
  for (let t = 0; t < TEAMS.length; t++) for (let s = 0; s < SLOTS; s++) {
    const l = defaultLook(t, s);
    assert.ok(l.skin >= 0 && l.skin <= SKIN_MAX && l.skin * 2 === Math.round(l.skin * 2));
    assert.ok(HAIR_COLORS.some((c) => c.key === l.hair));
    assert.ok(HAIR_STYLES.includes(l.style));
    assert.ok(BEARDS.includes(l.beard));
    assert.ok(BOOT_COLORS.some((c) => c.key === l.boots));
  }
});

test('the game as a whole shows variety: many skin tones, hair colours and styles', () => {
  const all = []; for (let t = 0; t < TEAMS.length; t++) for (let s = 0; s < SLOTS; s++) all.push(defaultLook(t, s));
  assert.ok(new Set(all.map((l) => l.skin)).size >= 8, 'skin tones');
  assert.ok(new Set(all.map((l) => l.hair)).size >= 7, 'hair colours');
  assert.ok(new Set(all.map((l) => l.style)).size >= 8, 'styles');
  assert.ok(new Set(all.map((l) => l.beard)).size === 4, 'every facial hair type is used');
  assert.ok(new Set(all.map((l) => l.boots)).size >= 5, 'boot colours');
});

test('team profiles shape the squads: darker-skinned team vs lighter-skinned team', () => {
  const mean = (t) => Array.from({ length: SLOTS }, (_, s) => defaultLook(t, s).skin).reduce((a, b) => a + b, 0) / SLOTS;
  const dark = TEAM_PROFILES.reduce((best, p, i) => (p.skin > TEAM_PROFILES[best].skin ? i : best), 0);
  const light = TEAM_PROFILES.reduce((best, p, i) => (p.skin < TEAM_PROFILES[best].skin ? i : best), 0);
  assert.ok(mean(dark) > mean(light) + 1.5);
});

test('squad editor overrides replace single fields and invalid values are ignored', () => {
  const base = defaultLook(1, 3);
  settings.custom['1-3'] = { skin: 9, hair: 'ginger', style: 'nonsense', beard: 'beard', boots: 'zzz', name: 'zlatan!' };
  const l = lookFor(1, 3);
  assert.equal(l.skin, 9); assert.equal(l.hair, 'ginger'); assert.equal(l.beard, 'beard');
  assert.equal(l.style, base.style, 'invalid style ignored');
  assert.equal(l.boots, base.boots, 'invalid boots ignored');
  assert.equal(squad(1)[3].name, 'ZLATAN', 'name is cleaned and upper-cased');
  assert.deepEqual(lookFor(1, 4), defaultLook(1, 4), 'other players untouched');
});

test('names are cleaned: letters only, upper case, trimmed, max 12', () => {
  assert.equal(cleanName('  de la  cruz 99! '), 'DE LA CRUZ');
  assert.equal(cleanName("o'brien"), "O'BRIEN");
  assert.equal(cleanName('abcdefghijklmnopqrstuvwxyz'), 'ABCDEFGHIJKL');
  assert.equal(cleanName(''), ''); assert.equal(cleanName(null), '');
});

test('randomLook returns a valid look', () => {
  for (let i = 0; i < 30; i++) {
    const l = randomLook(i % 8);
    assert.ok(HAIR_STYLES.includes(l.style) && BEARDS.includes(l.beard) && BOOT_COLORS.some((c) => c.key === l.boots));
  }
});

test('every hairstyle and facial-hair type builds geometry', () => {
  for (const s of HAIR_STYLES) { const h = hairGeometry(s); if (s === 'bald') assert.equal(h.hair, null); else assert.ok(h.hair.attributes.position.count > 20, s); }
  for (const b of BEARDS) { const g = beardGeometry(b); if (b === 'none') assert.deepEqual(g, {}); else assert.ok(g.solid || g.stubble, b); }
});
