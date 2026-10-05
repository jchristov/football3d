import test from 'node:test';
import assert from 'node:assert/strict';
import { tint, tn, teamTextColor } from '../src/teamcolor.js';
import { TEAMS } from '../src/teams.js';

test('only the team name is coloured, the rest of the text is untouched and HTML-safe', () => {
  const html = tint('Blue Comets v Red Rockets — <b>and we are underway!</b>');
  assert.equal((html.match(/class="tn"/g) || []).length, 2);
  assert.ok(html.includes(`${tn(0)} v ${tn(1)} — &lt;b&gt;`), html);
  assert.ok(!html.includes('<b>'));
  assert.equal(tint('Nobody here'), 'Nobody here');
});

test('every team gets a distinct, readable text colour', () => {
  const cols = TEAMS.map((_, i) => teamTextColor(i));
  assert.equal(new Set(cols).size, TEAMS.length);
  for (const c of cols) assert.match(c, /^rgb\(\d+,\d+,\d+\)$/);
  assert.ok(tint(`${TEAMS[2].name} win the cup`).includes('<span class="tn"'));
});
