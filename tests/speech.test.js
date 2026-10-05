import test from 'node:test';
import assert from 'node:assert/strict';
import { Speech, cleanSpeech, voiceScore, sortVoices, isNaturalVoice } from '../src/speech.js';
import { settings, resetSettings } from '../src/settings.js';

const VOICES = [
  { name: 'Microsoft Katja Online (Natural) - German (Germany)', lang: 'de-DE', voiceURI: 'katja', localService: false },
  { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', voiceURI: 'aria', localService: false },
  { name: 'Microsoft Sonia Online (Natural) - English (United Kingdom)', lang: 'en-GB', voiceURI: 'sonia', localService: false },
  { name: 'Microsoft Zira Desktop - English (United States)', lang: 'en-US', voiceURI: 'zira', localService: true, default: true },
  { name: 'Google UK English Female', lang: 'en-GB', voiceURI: 'gukf', localService: false },
  { name: 'eSpeak English', lang: 'en', voiceURI: 'espeak', localService: true },
];

// A fake speechSynthesis: utterances stay "active" until finish() is called
function fake(voices = VOICES) {
  const spoken = [];
  const synth = {
    getVoices: () => voices,
    speak(u) { this.active = u; spoken.push(u); },
    cancel() { this.cancels = (this.cancels || 0) + 1; this.active = null; },
    active: null, cancels: 0,
  };
  class Utter { constructor(text) { this.text = text; } }
  let clock = 0;
  const sp = new Speech({ synth, Utter, now: () => clock });
  const finish = () => { const u = synth.active; synth.active = null; u?.onend?.(); };
  return { sp, synth, spoken, finish, advance: (s) => { clock += s; } };
}

test.beforeEach(() => resetSettings());

test('cleanSpeech removes emoji and symbols and reads scores naturally', () => {
  assert.equal(cleanSpeech('⚽ Almeida scores! — 3-1'), 'Almeida scores!, 3 1');
  assert.equal(cleanSpeech('🎙  Great   save by Mbeki!'), 'Great save by Mbeki!');
  assert.equal(cleanSpeech(''), ''); assert.equal(cleanSpeech(null), '');
});

test('only Microsoft Natural voices are accepted', () => {
  assert.deepEqual(VOICES.filter(isNaturalVoice).map((v) => v.voiceURI), ['katja', 'aria', 'sonia']);
  assert.equal(isNaturalVoice({ name: 'Google UK English Female' }), false);
  assert.equal(isNaturalVoice({ name: 'Microsoft Zira Desktop' }), false, 'classic Microsoft voices are not Natural');
  assert.equal(isNaturalVoice({ name: 'Natural Reader' }), false, 'must be a Microsoft voice');
  assert.equal(isNaturalVoice(null), false);
  const { sp } = fake();
  assert.deepEqual(sp.voices().map((v) => v.voiceURI).sort(), ['aria', 'katja', 'sonia'], 'the list offers nothing else');
});

test('automatic voice prefers British English, then US English, then other languages', () => {
  assert.ok(voiceScore(VOICES[2]) > voiceScore(VOICES[1]));
  assert.ok(voiceScore(VOICES[1]) > voiceScore(VOICES[0]));
  const { sp } = fake();
  assert.equal(sp.voice('').voiceURI, 'sonia');
  assert.ok(sortVoices(VOICES.filter(isNaturalVoice)).slice(0, 2).every((v) => v.lang.startsWith('en')), 'English voices come first');
});

test('Andrew Multilingual is the automatic voice when it is installed', () => {
  const andrew = { voiceURI: 'andrew', name: 'Microsoft AndrewMultilingual Online (Natural) - English (United States)', lang: 'en-US', localService: false };
  assert.ok(voiceScore(andrew) > voiceScore(VOICES[2]), 'beats the British voice');
  const { sp } = fake([...VOICES, andrew]);
  assert.equal(sp.voice('').voiceURI, 'andrew');
  settings.ttsVoice = 'aria';
  assert.equal(sp.voice().voiceURI, 'aria', 'an explicit choice still wins');
});

test('a non-Natural voice can never be chosen, even through the settings; and without Natural voices nothing is spoken', () => {
  const { sp, spoken } = fake();
  settings.ttsVoice = 'espeak';
  assert.equal(sp.voice().voiceURI, 'sonia', 'falls back to the best Natural voice');
  sp.speak('Goal!', 5);
  assert.equal(spoken[0].voice.voiceURI, 'sonia');
  const none = fake();
  none.synth.getVoices = () => VOICES.filter((v) => !isNaturalVoice(v));
  assert.equal(none.sp.hasVoices, false);
  assert.equal(none.sp.speak('Goal!', 5), false);
  assert.equal(none.sp.test('hello'), false);
  assert.equal(none.spoken.length, 0);
});

test('the selected voice, speed and volume from the settings are used; a missing voice falls back to automatic', () => {
  const { sp, spoken } = fake();
  settings.ttsVoice = 'katja'; settings.ttsRate = 1.4; settings.ttsVolume = 0.5;
  sp.speak('Goal!', 5);
  assert.equal(spoken[0].voice.voiceURI, 'katja'); assert.equal(spoken[0].rate, 1.4); assert.equal(spoken[0].volume, 0.5);
  settings.ttsVoice = 'gone-voice';
  assert.equal(sp.voice().voiceURI, 'sonia');
  settings.ttsRate = 9; settings.ttsVolume = 7;
  const f = fake(); f.sp.speak('x', 1);
  assert.equal(f.spoken[0].rate, 2); assert.equal(f.spoken[0].volume, 1, 'values are clamped');
});

test('minor lines are dropped while speaking; important lines interrupt', () => {
  const { sp, synth, spoken } = fake();
  assert.ok(sp.speak('Tackle.', 1));
  assert.equal(sp.speak('Another tackle.', 1), false);
  assert.equal(spoken.length, 1);
  assert.ok(sp.speak('Goal!', 5));
  assert.equal(synth.cancels, 1);
  assert.equal(spoken.at(-1).text, 'Goal!');
});

test('a waiting normal line is spoken after the current one, only if it is still fresh', () => {
  const a = fake();
  a.sp.speak('First.', 2); a.sp.speak('Second.', 2);
  assert.equal(a.spoken.length, 1);
  a.advance(1); a.finish();
  assert.equal(a.spoken.at(-1).text, 'Second.');
  const b = fake();
  b.sp.speak('First.', 2); b.sp.speak('Stale.', 2);
  b.advance(10); b.finish();
  assert.equal(b.spoken.length, 1, 'a line that waited too long is skipped');
  b.sp.speak('Next.', 1);
  assert.equal(b.spoken.at(-1).text, 'Next.', 'and speech is free again afterwards');
});

test('only the latest of several waiting lines is kept', () => {
  const { sp, spoken, finish, advance } = fake();
  sp.speak('A', 2); sp.speak('B', 2); sp.speak('C', 3);
  advance(0.5); finish();
  assert.equal(spoken.at(-1).text.length > 0, true);
});

test('muted, switched off or unsupported: nothing is spoken', () => {
  let muted = true;
  const f = fake(); f.sp.isMuted = () => muted;
  assert.equal(f.sp.speak('Muted', 5), false); muted = false;
  settings.tts = false;
  assert.equal(f.sp.speak('Disabled', 5), false); settings.tts = true;
  assert.equal(f.spoken.length, 0);
  const none = new Speech({ synth: null });
  assert.equal(none.supported, false); assert.equal(none.speak('x', 5), false); assert.deepEqual(none.voices(), []); assert.equal(none.test(), false);
});

test('the "test voice" button speaks even when muted or switched off', () => {
  const f = fake(); f.sp.isMuted = () => true; settings.tts = false;
  assert.ok(f.sp.test('Hello'));
  assert.equal(f.spoken.at(-1).text, 'Hello');
  assert.equal(f.sp.enabled, false, 'and the mute state is restored afterwards');
});

test('stop() cancels the voice and forgets what was waiting', () => {
  const { sp, synth, spoken, finish } = fake();
  sp.speak('A', 2); sp.speak('B', 2); sp.stop();
  assert.equal(synth.cancels, 1); assert.equal(sp.speaking, false);
  finish();
  assert.equal(spoken.length, 1, 'B never gets spoken');
});

test('the stadium announcer waits for the commentator, speaks in a deeper slower voice and never interrupts', () => {
  const { sp, spoken, finish } = fake();
  sp.speak('Great chance for the home side!', 3);
  assert.equal(sp.announce('Goal for Blue Comets! Scored by number nine, Pavlov.'), true);
  assert.equal(spoken.length, 1, 'the announcer is silent while the commentary runs');
  finish();
  assert.equal(spoken.length, 2);
  assert.ok(spoken[1].pitch < 1 && spoken[1].rate < spoken[0].rate, 'deeper and slower than the commentator');
  assert.match(spoken[1].text, /Pavlov/);
  finish();
  assert.equal(sp.speaking, false);
});

test('a burst of announcements keeps only the latest three, old ones are dropped, and a goal-level line interrupts them', () => {
  const { sp, spoken, finish } = fake();
  sp.speak('Commentary', 2);
  for (const t of ['one', 'two', 'three', 'four', 'five']) sp.announce(t);
  assert.deepEqual(sp.ann.map((a) => a.text), ['three', 'four', 'five']);
  sp.speak('GOAL!', 5);
  assert.equal(sp.ann.length, 0, 'announcements are cancelled by an interruption');
  finish(); // the goal line ends
  assert.equal(spoken.at(-1).text, 'GOAL!');
});

test('the announcer can be switched off in the settings', () => {
  const { sp, spoken } = fake();
  settings.announcer = false;
  assert.equal(sp.announce('Welcome to the stadium'), false);
  assert.equal(spoken.length, 0);
  settings.announcer = true;
});
