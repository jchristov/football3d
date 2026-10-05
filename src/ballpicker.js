import { BALL_FACES, RANDOM_FACE, ballPreview } from './ballskin.js';
import { settings, saveSettings, onSettings } from './settings.js';
import { BALL_SIZES } from './constants.js';

// Grid of ball faces (plus "Random") with preview pictures; the choice is stored and applied live.
// Thumbnails are painted one per tick so opening the menu never stalls.
export function buildBallPicker(el) {
  const opts = Object.entries(BALL_FACES).map(([key, f]) => `<button class="ballopt" data-ball="${key}" title="${f.label}"><img alt="" width="48" height="48" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><span>${f.label}</span></button>`);
  opts.push(`<button class="ballopt" data-ball="${RANDOM_FACE}" title="A different random ball for every match"><i class="dice">🎲</i><span>Random</span></button>`);
  el.innerHTML = opts.join('');
  const imgs = [...el.querySelectorAll('img')];
  const paint = (i) => {
    if (!el.isConnected || i >= imgs.length) return;
    const b = imgs[i].closest('button');
    imgs[i].src = ballPreview(b.dataset.ball, 96);
    setTimeout(() => paint(i + 1), 0);
  };
  setTimeout(() => paint(0), 30);
  const mark = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.ball === settings.ball));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.ball = b.dataset.ball;
    saveSettings();
  });
  const off = onSettings(() => { if (el.isConnected) mark(); else off(); });
  mark();
}

// The face shown in the size picker: the selected ball, or the classic one when Random is selected
export const sizeFace = () => (settings.ball && settings.ball !== RANDOM_FACE && BALL_FACES[settings.ball] ? settings.ball : 'classic');

// Size 1-5 picker: each button shows the selected ball face at its real relative size (like a size chart),
// with its diameter and age group
export function buildBallSizePicker(el) {
  const max = BALL_SIZES[5].d;
  const box = 56; // the size-5 ball fills this many px
  el.innerHTML = Object.entries(BALL_SIZES).map(([k, s]) => {
    const px = Math.round(box * (s.d / max));
    return `<button class="sizeopt" data-size="${k}" title="${s.label}: ${s.cm} cm across, ${s.circ} round — ${s.age}">
      <span class="szball" style="width:${box}px;height:${box}px"><img alt="" width="${px}" height="${px}" style="width:${px}px;height:${px}px"></span>
      <b>${s.label}</b><em>${s.cm} cm</em><small>${s.age}</small></button>`;
  }).join('');
  let shown = null;
  const paint = () => {
    const face = sizeFace();
    if (face === shown) return;
    shown = face;
    const src = ballPreview(face, 112);
    el.querySelectorAll('img').forEach((i) => { i.src = src; });
  };
  const mark = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.size) === Number(settings.ballSize)));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.ballSize = Number(b.dataset.size);
    saveSettings();
  });
  const off = onSettings(() => { if (el.isConnected) { mark(); paint(); } else off(); });
  setTimeout(paint, 60); // after the face thumbnails, so opening the menu never stalls
  mark();
}
