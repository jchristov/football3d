import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Environment } from './env.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Menu } from './menu.js';
import { SettingsUI } from './settings-ui.js';
import { PadNav } from './padnav.js';
import { TouchControls } from './touch.js';
import { applyDevice, touchWanted, phoneFactor, panelZoom } from './device.js';
import { FS_ENTER, FS_EXIT } from './icons.js';
import { bindMouse } from './mouse.js';
import { TacticsUI } from './tacticsui.js';
import { SquadUI } from './squadui.js';
import { HelpUI } from './helpui.js';
import { LineupUI } from './lineupui.js';
import { NetUI } from './net/netui.js';
import { ClipRecorder } from './recorder.js';
import { FpsGovernor, NEXT_LOWER } from './perf.js';
import { settings, onSettings, saveSettings, clampUiScale, clampTouchScale, motionReduced } from './settings.js';

applyDevice(); // phones and tablets: touch controls, no keyboard hints (body.nokb)
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 400);

const resize = () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
window.addEventListener('resize', resize);

const world = buildWorld(scene);
{ // no confetti when motion is reduced
  const burst = world.confetti.burst.bind(world.confetti);
  world.confetti.burst = (...a) => { if (!document.body.classList.contains('rm')) burst(...a); };
}
const env = new Environment(scene, world);
const hud = new Hud();
const sfx = new Sfx();
const input = new Input();
env.onChange = (e) => { renderer.toneMappingExposure = e.exposure; sfx.setWeather(e.weather); };

// Graphics quality: resolution, shadows, crowd animation and weather particle density
const QUALITY = {
  high: { dpr: 2, shadow: 2048, shadows: true, crowd: true, particles: 1 },
  medium: { dpr: 1.5, shadow: 1024, shadows: true, crowd: true, particles: 0.6 },
  low: { dpr: 1, shadow: 1024, shadows: false, crowd: false, particles: 0.3 },
};
let appliedQuality = null;
function applyQuality() {
  const q = QUALITY[settings.quality] || QUALITY.high;
  if (appliedQuality === settings.quality) return;
  appliedQuality = settings.quality;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
  resize();
  const sh = world.sun.shadow;
  if (sh.mapSize.x !== q.shadow) { sh.mapSize.set(q.shadow, q.shadow); sh.map?.dispose(); sh.map = null; }
  env.shadows = q.shadows;
  env.particles = q.particles;
  world.crowd.animate = q.crowd && !document.body.classList.contains('rm');
  env.set(env.time, env.weather);
}
applyQuality();
env.onChange(env);
onSettings(applyQuality);

const muteBtn = document.getElementById('muteBtn');
const showMute = (m) => { muteBtn.textContent = m ? '🔇' : '🔊'; muteBtn.classList.toggle('off', m); };
sfx.onMuteChange = (m) => { showMute(m); if (m) game.speech.stop(); };
showMute(sfx.muted);
muteBtn.addEventListener('click', () => { sfx.init(); sfx.toggleMute(); muteBtn.blur(); });

const game = new Game({ scene, camera, world, env, hud, sfx, input });
const menu = new Menu(game, hud, sfx);
const settingsUI = new SettingsUI(input, game.speech);
const tacticsUI = new TacticsUI(game, hud);
const squadUI = new SquadUI(game);
const helpUI = new HelpUI();
const lineupUI = new LineupUI(game, tacticsUI);
game.recorder = new ClipRecorder(canvas);
const netUI = new NetUI(game, menu);
menu.netUI = netUI;
menu.refresh();
document.getElementById('netOpen').addEventListener('click', () => netUI.show());
window.__net = netUI;
netUI.openFromLink(); // opened from a shared link or QR code (?join=CODE, #invite=CODE): join straight away
// Every human match opens with the team sheets (Settings can switch that off); the kick-off waits for the button
const startMatch = game.startMatch.bind(game);
game.startMatch = (cfg) => {
  startMatch(cfg);
  if (settings.lineupScreen && cfg.mode !== 'cpu' && !cfg.net) {
    game.hold = true;
    game.modal = true;
    lineupUI.show(() => { game.hold = false; game.modal = false; showTouchHint(); });
  } else if (cfg.mode === '1p') showTouchHint();
};
game.onHalftime = () => tacticsUI.show({ halftime: true });
const padNav = new PadNav(input, menu, settingsUI);
// Touch: the on-screen stick and buttons appear on touch devices, and on any device at the first touch
let touchControls = null;
const enableTouch = () => { touchControls ||= new TouchControls(input, document.getElementById('hud')); };
if (touchWanted()) enableTouch();
window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') enableTouch(); }, { passive: true });
// Which touch buttons matter right now: with the ball (shoot, pass) or without it (tackle, switch)
const touchContext = () => {
  const c = game.ctrls[0];
  if (game.attract || !c?.enabled || !c.player || game.state === 'ended') return 'idle';
  const b = game.ball;
  return b.owner === c.player || b.held === c.player || (game.state === 'setpiece' && game.rules.sp?.kicker === c.player) ? 'ball' : 'chase';
};
const showTouchHint = () => { if (touchControls && document.body.classList.contains('nokb') && settings.touchHint !== false) { touchControls.hint(); settings.touchHint = false; saveSettings(); } };
// Mouse: run to the pointer, left click shoot, right click pass, middle click tackle, wheel switch (Settings can switch it off)
bindMouse(input, canvas);
game.pointerRect = () => canvas.getBoundingClientRect();
const applyMouse = () => { input.mouse.enabled = settings.mouse !== false; };
applyMouse();
onSettings(applyMouse);

// Settings can be opened at any time. During a match the game pauses while the panel is open and carries on when it closes.
const PAUSABLE = ['playing', 'countdown', 'goal', 'foul', 'setpiece', 'sopause'];
const withPause = (panel) => {
  if (panel.open) return;
  const pausedByUs = PAUSABLE.includes(game.state) && !game.attract;
  if (pausedByUs) game.togglePause();
  game.modal = true;
  panel.show(() => {
    game.modal = false;
    if (pausedByUs && game.state === 'paused') game.togglePause();
    else if (game.state === 'paused') document.getElementById('pauseSettings')?.focus();
  });
};
const openSettings = () => withPause(settingsUI);
// Team changes (formation, pressing, substitutions) at any time: the match pauses while the panel is open
const toggleSettings = () => (settingsUI.open ? settingsUI.hide() : openSettings());
const openTeam = () => {
  if (tacticsUI.open || game.attract) return;
  if (game.state === 'ended' || game.state === 'halftime') { hud.toast(game.state === 'ended' ? 'The match is over' : 'Use the half-time panel', 1400); return; }
  withPause({ get open() { return tacticsUI.open; }, show: (onClose) => tacticsUI.show({ onClose }) });
};
const toggleTeam = () => { if (tacticsUI.open) { if (!tacticsUI.halftime) tacticsUI.close(); } else openTeam(); };
const toggleBars = () => { settings.playerBars = !settings.playerBars; saveSettings(); hud.toast(settings.playerBars ? 'Player bars on' : 'Player bars off', 900); };
const toggleFullscreen = () => {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else el.requestFullscreen?.().catch(() => hud.toast('Full screen is not available here', 1500));
};
const toggleEvents = () => { settings.events = !settings.events; saveSettings(); };
const toggleHelp = () => (helpUI.open ? helpUI.hide() : withPause(helpUI));
const applyUi = () => {
  hud.setMinimap(settings.minimap);
  const a = Math.min(1, Math.max(0.3, Number(settings.panelOpacity) || 0.86));
  document.documentElement.style.setProperty('--pa', a);
  const ui = clampUiScale(settings.uiScale);
  document.documentElement.style.setProperty('--uz', ui * (document.body.classList.contains('nokb') ? panelZoom(window.innerHeight) : 1)); // panels: smaller on a phone
  document.documentElement.style.setProperty('--ui', ui * (document.body.classList.contains('nokb') ? phoneFactor(window.innerHeight) : 1)); // on-screen widgets: smaller on a phone held sideways
  document.documentElement.style.setProperty('--ts', clampTouchScale(settings.touchScale)); // touch buttons
  document.body.classList.toggle('cblind', !!settings.colorBlind);
  const rm = motionReduced(settings, typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  document.body.classList.toggle('rm', rm);
  world.crowd.animate = (QUALITY[settings.quality] || QUALITY.high).crowd && !rm;
};
applyUi();
onSettings(applyUi);
window.addEventListener('resize', applyUi);
document.getElementById('hudSettings').addEventListener('click', (e) => { toggleSettings(); e.currentTarget.blur(); });
document.getElementById('hudTeam').addEventListener('click', (e) => { toggleTeam(); e.currentTarget.blur(); });
const fsBtn = document.getElementById('fsBtn');
if (!document.documentElement.requestFullscreen) fsBtn.classList.add('hidden');
fsBtn.addEventListener('click', () => { toggleFullscreen(); fsBtn.blur(); });
const showFsIcon = () => {
  const on = !!document.fullscreenElement;
  fsBtn.innerHTML = on ? FS_EXIT : FS_ENTER;
  fsBtn.title = on ? 'Leave full screen (X)' : 'Full screen (X)';
  const pf = document.getElementById('pauseFs');
  if (pf) pf.innerHTML = `${on ? FS_EXIT : FS_ENTER} ${on ? 'Leave full screen' : 'Full screen'}`;
};
document.addEventListener('fullscreenchange', showFsIcon);
showFsIcon();

// Install as an app (the browser offers this when the manifest and the service worker are in place)
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; document.getElementById('installBtn').classList.remove('hidden'); });
window.addEventListener('appinstalled', () => { installEvent = null; document.getElementById('installBtn').classList.add('hidden'); });
document.getElementById('installBtn').addEventListener('click', async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; document.getElementById('installBtn').classList.add('hidden'); });
if ('serviceWorker' in navigator && import.meta.env?.PROD) navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });

document.getElementById('evToggle').addEventListener('click', (e) => { toggleEvents(); e.currentTarget.blur(); });
document.getElementById('menuSettings').addEventListener('click', openSettings);
document.getElementById('menuSquads').addEventListener('click', () => squadUI.show());
document.getElementById('pauseTactics').addEventListener('click', () => tacticsUI.show());
// The pause menu works without a keyboard: resume, camera, autopilot, full screen and quitting the match are buttons
const $id = (id) => document.getElementById(id);
const quitBtn = $id('pauseQuit');
let quitTimer = 0;
const QUIT_LABEL = '🏠 Quit match';
const refreshPause = () => {
  const solo = game.mode === '1p' && !game.rules.so;
  $id('pauseAuto').disabled = !solo;
  $id('pauseAuto').classList.toggle('on', game.autopilot);
  $id('pauseCamera').textContent = `🎥 Camera: ${game.camModes[game.camMode] || ''}`;
  clearTimeout(quitTimer); quitBtn.textContent = QUIT_LABEL; quitBtn.classList.remove('armed');
};
const showPause = hud.showPause.bind(hud);
hud.showPause = (on) => { showPause(on); if (on) refreshPause(); };
$id('pauseResume').addEventListener('click', () => game.togglePause());
$id('pauseCamera').addEventListener('click', () => { input.tap('KeyC'); setTimeout(refreshPause, 60); });
$id('pauseAuto').addEventListener('click', () => { game.toggleAutopilot(); refreshPause(); });
$id('pauseFs').addEventListener('click', toggleFullscreen);
quitBtn.addEventListener('click', () => {
  if (!quitBtn.classList.contains('armed')) {
    quitBtn.classList.add('armed'); quitBtn.textContent = 'Tap again to quit';
    quitTimer = setTimeout(() => { quitBtn.classList.remove('armed'); quitBtn.textContent = QUIT_LABEL; }, 3000);
    return;
  }
  clearTimeout(quitTimer);
  hud.showPause(false);
  menu.toMenu();
});
$id('autoBadge').addEventListener('click', () => game.toggleAutopilot()); // touch: tap the badge to take control again
$id('replaySkip').addEventListener('click', () => game.endReplay());
document.getElementById('pauseSettings').addEventListener('click', openSettings);
document.getElementById('bestBtn').addEventListener('click', () => game.playBest());
document.getElementById('clipBtn').addEventListener('click', () => { game.recordNext = true; if (!game.playBest()) game.recordNext = false; });
document.getElementById('replaySave').addEventListener('click', (e) => { game.recordCurrentReplay(); e.currentTarget.blur(); });

window.__game = game; // handy for debugging in the console
window.__menu = menu;
window.__settings = settingsUI;
window.__input = input;
window.__tactics = tacticsUI;
window.__squad = squadUI;
window.__help = helpUI;
window.__render = () => renderer.render(scene, camera);

window.addEventListener('keydown', (e) => {
  if (e.repeat || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  if (lineupUI.open && e.code !== 'Escape') return; // the team sheets own the keyboard until kick-off
  if (netUI.open) return; // the connection panel owns the keyboard (it has text boxes)
  const free = !settingsUI.open && !tacticsUI.open && !squadUI.open && !helpUI.open;
  if (e.code === 'Enter' && free) menu.primary();
  if (e.code === 'KeyO' && !tacticsUI.open && !squadUI.open && !helpUI.open) toggleSettings();
  if (e.code === 'KeyU' && !settingsUI.open && !squadUI.open && !helpUI.open) toggleTeam();
  if (e.code === 'KeyI' && free && !game.attract) toggleEvents();
  if (e.code === 'KeyG' && free && !game.attract) toggleBars();
  if (e.code === 'KeyX') toggleFullscreen();
  if (e.code === 'KeyH' && !settingsUI.open && !tacticsUI.open && !squadUI.open) toggleHelp();
  if (e.code === 'KeyB' && free) { settings.minimap = !settings.minimap; saveSettings(); }
});

let last = performance.now();
const governor = new FpsGovernor();
function checkPerformance(dt) {
  const active = settings.autoQuality !== false && !document.hidden && game.state !== 'paused' && !netUI.open && !settingsUI.open;
  if (!governor.update(dt, active)) return;
  const next = NEXT_LOWER[settings.quality];
  if (!next) return;
  settings.quality = next; saveSettings();
  hud.toast(`Graphics lowered to ${next} for a smoother game (Settings → Graphics)`, 3500);
}

function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  checkPerformance(dt);
  game.update(dt);
  canvas.classList.toggle('aim', game.mouseOn);
  touchControls?.setContext(touchContext());
  padNav.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
