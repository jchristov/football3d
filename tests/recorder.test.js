import test from 'node:test';
import assert from 'node:assert/strict';
import { ClipRecorder, pickMimeType, extensionFor, clipName } from '../src/recorder.js';
import { makeGame, startCpuMatch, runUntil, step, seedRandom, resetGlobals } from './helpers.js';

test.beforeEach(() => resetGlobals());

class FakeMR {
  static isTypeSupported(t) { return t === 'video/webm;codecs=vp8' || t === 'video/webm'; }
  constructor(stream, opts) { this.stream = stream; this.opts = opts; this.state = 'inactive'; FakeMR.last = this; }
  start() { this.state = 'recording'; setTimeout(() => this.ondataavailable?.({ data: { size: 10 } }), 0); }
  stop() { this.state = 'inactive'; setTimeout(() => this.onstop?.(), 1); }
}
const canvas = { captureStream: (fps) => ({ fps }) };

test('the best supported video type is chosen and file names carry the date', () => {
  assert.equal(pickMimeType((t) => t === 'video/webm'), 'video/webm');
  assert.equal(pickMimeType((t) => t.startsWith('video/webm;codecs=vp9')), 'video/webm;codecs=vp9');
  assert.equal(pickMimeType(() => false), '');
  assert.equal(extensionFor('video/mp4'), 'mp4'); assert.equal(extensionFor('video/webm;codecs=vp8'), 'webm');
  assert.equal(clipName(new Date(2026, 9, 5, 14, 7, 9), 'webm'), 'turbo-football-goal-20261005-140709.webm');
});

test('a recording is started, stopped and handed to the download function', async () => {
  const saved = [];
  const r = new ClipRecorder(canvas, { MediaRecorder: FakeMR, download: (b, n) => saved.push([b, n]), now: () => new Date(2026, 0, 2, 3, 4, 5) });
  assert.equal(r.supported, true);
  assert.equal(r.start(), true);
  assert.equal(r.active, true); assert.equal(r.start(), false, 'one recording at a time');
  assert.deepEqual(FakeMR.last.stream, { fps: 30 }); assert.equal(FakeMR.last.opts.mimeType, 'video/webm;codecs=vp8');
  await new Promise((res) => setTimeout(res, 5));
  const name = await r.finish('goal');
  assert.equal(name, 'turbo-football-goal-20260102-030405.webm');
  assert.equal(saved.length, 1); assert.equal(saved[0][1], name);
  assert.equal(r.active, false);
  assert.equal(await r.finish(), '', 'nothing to finish');
});

test('without MediaRecorder or captureStream nothing is recorded', () => {
  assert.equal(new ClipRecorder(canvas, { MediaRecorder: null }).supported, false);
  assert.equal(new ClipRecorder({}, { MediaRecorder: FakeMR }).start(), false);
});

test('an empty recording is not downloaded', async () => {
  class Empty extends FakeMR { start() { this.state = 'recording'; } }
  const saved = [];
  const r = new ClipRecorder(canvas, { MediaRecorder: Empty, download: (...a) => saved.push(a) });
  r.start();
  assert.equal(await r.finish(), '');
  assert.equal(saved.length, 0);
});

function goalReplayGame() {
  seedRandom(15);
  const g = makeGame();
  startCpuMatch(g, { length: 600 });
  runUntil(g, () => g.state === 'playing', 10);
  step(g, 12);
  return g;
}

test('"record this replay" restarts the replay and saves it when the replay ends', async () => {
  const g = goalReplayGame();
  const calls = [];
  g.recorder = { start: () => { calls.push('start'); return true; }, finish: (w) => { calls.push('finish:' + w); return Promise.resolve('x.webm'); } };
  assert.equal(g.startReplay(g.replay.now - 8, g.replay.now, 'manual', 0.8), true);
  step(g, 0.5);
  assert.ok(g.replay.t > g.replay.from + 0.3);
  assert.equal(g.recordCurrentReplay(), true);
  assert.equal(g.replay.t, g.replay.from, 'the replay starts again from the beginning');
  assert.deepEqual(calls, ['start']);
  g.endReplay();
  assert.deepEqual(calls, ['start', 'finish:replay']);
  assert.equal(g.clipping, false);
});

test('without a recorder or outside a replay nothing happens', () => {
  const g = goalReplayGame();
  g.recorder = { start: () => true, finish: () => Promise.resolve('') };
  assert.equal(g.recordCurrentReplay(), false, 'not in a replay');
  g.recorder = null;
  g.startReplay(g.replay.now - 8, g.replay.now, 'manual', 0.8);
  assert.equal(g.recordCurrentReplay(), false, 'no recorder available');
});

test('an unsupported browser reports it instead of failing', () => {
  const g = goalReplayGame();
  g.recorder = { start: () => false, finish: () => Promise.resolve('') };
  g.startReplay(g.replay.now - 8, g.replay.now, 'manual', 0.8);
  g.recordCurrentReplay();
  assert.equal(g.clipping, false);
});
