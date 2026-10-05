import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const css = read('src/style.css');

test('every text button has one of two heights, defined once', () => {
  assert.match(css, /--btn-h:\s*44px/); assert.match(css, /--btn-h-sm:\s*34px/);
  assert.match(css, /min-height:\s*var\(--btn-h\)/); assert.match(css, /min-height:\s*var\(--btn-h-sm\)/);
  assert.match(css, /#startBtn[^{]*\{[^}]*min-height:\s*var\(--btn-h\)/s, 'the start button follows the same height');
});

test('buttons do not set their own padding or font size inline (it would break the sizes)', () => {
  const files = ['index.html', ...fs.readdirSync(new URL('../src', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`), ...fs.readdirSync(new URL('../src/net', import.meta.url)).map((f) => `src/net/${f}`)];
  for (const f of files) {
    for (const m of read(f).matchAll(/<button\b[^>]*style="([^"]*)"/g)) assert.doesNotMatch(m[1], /padding|font-size|height/, `${f}: ${m[0].slice(0, 80)}`);
  }
});
