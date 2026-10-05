import { HEAT_W, HEAT_H } from './stats.js';

// ---- data (pure functions, tested without a canvas) ----

// Heat grid scaled to 0..1 (square-root so that the quiet areas stay visible)
export function heatLevels(grid) {
  const max = Math.max(1e-6, ...grid);
  return Array.from(grid, (v) => Math.sqrt(v / max));
}

// The passing network of a team: a node per player (average position, touches) and an edge per pair (completed passes)
export function passNetwork(stats, team) {
  const nodes = [];
  for (const r of stats.players.values()) if (r.team === team && r.samples > 0) nodes.push({ slot: r.slot, num: r.num, name: r.name, x: r.sx / r.samples, z: r.sz / r.samples, touches: r.touches, passes: r.passes });
  const edges = [];
  for (const [k, n] of stats.pairs) {
    const m = /^(\d+)-(\d+)>(\d+)$/.exec(k);
    if (!m || Number(m[1]) !== team) continue;
    edges.push({ from: Number(m[2]), to: Number(m[3]), n });
  }
  return { nodes, edges };
}

// Best passers and runners of a team
export function topPassers(stats, team, limit = 3) {
  return [...stats.players.values()].filter((r) => r.team === team && r.passes > 0).sort((a, b) => b.passesOk - a.passesOk || b.passes - a.passes).slice(0, limit)
    .map((r) => ({ num: r.num, name: r.name, ok: r.passesOk, total: r.passes, pct: Math.round((r.passesOk / r.passes) * 100) }));
}
export function topRunners(stats, team, limit = 3) {
  return [...stats.players.values()].filter((r) => r.team === team && r.meters > 0).sort((a, b) => b.meters - a.meters).slice(0, limit)
    .map((r) => ({ num: r.num, name: r.name, meters: Math.round(r.meters) }));
}
export const teamDistance = (stats, team) => Math.round([...stats.players.values()].filter((r) => r.team === team).reduce((a, r) => a + r.meters, 0));

// ---- drawing ----

const hexc = (n) => '#' + n.toString(16).padStart(6, '0');

// A pitch seen from above: x -1..1 (left to right), z -1..1 (top to bottom)
function pitch(g, W, H, { half = false } = {}) {
  g.fillStyle = '#1e7a3f'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.2;
  g.strokeRect(1, 1, W - 2, H - 2);
  g.beginPath(); g.moveTo(W / 2, 1); g.lineTo(W / 2, H - 1); g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2, H * 0.14, 0, Math.PI * 2); g.stroke();
  const bw = W * 0.12, bh = H * 0.5;
  g.strokeRect(1, (H - bh) / 2, bw, bh); g.strokeRect(W - 1 - bw, (H - bh) / 2, bw, bh);
}

const X = (W, x) => ((x + 1) / 2) * W, Z = (H, z) => ((z + 1) / 2) * H;

export function drawHeat(g, W, H, grid, color) {
  pitch(g, W, H);
  const lv = heatLevels(grid), cw = W / HEAT_W, ch = H / HEAT_H;
  for (let j = 0; j < HEAT_H; j++) for (let i = 0; i < HEAT_W; i++) {
    const a = lv[j * HEAT_W + i];
    if (a < 0.05) continue;
    g.fillStyle = color; g.globalAlpha = Math.min(0.85, a * 0.9);
    g.fillRect(i * cw, j * ch, cw + 0.5, ch + 0.5);
  }
  g.globalAlpha = 1;
  pitch(g, W, H); // lines on top
}

// Both teams' shots on one pitch: team 0 attacks the right goal, team 1 the left one (positions are mirrored)
export function drawShots(g, W, H, shots, colors) {
  pitch(g, W, H);
  for (const s of shots) {
    const x = s.team === 0 ? s.x : -s.x, z = s.team === 0 ? s.z : -s.z;
    const cx = X(W, x), cz = Z(H, z), r = s.goal ? 6 : 4;
    g.beginPath();
    if (s.goal) { // a star for a goal
      for (let k = 0; k < 10; k++) { const rr = k % 2 ? r * 0.45 : r * 1.3, a = -Math.PI / 2 + (k * Math.PI) / 5; g.lineTo(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr); }
      g.closePath(); g.fillStyle = colors[s.team]; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
    } else {
      g.arc(cx, cz, r, 0, Math.PI * 2);
      if (s.on) { g.fillStyle = colors[s.team]; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke(); } else { g.strokeStyle = colors[s.team]; g.lineWidth = 1.6; g.stroke(); }
    }
  }
}

export function drawNetwork(g, W, H, net, color) {
  pitch(g, W, H);
  const pos = new Map(net.nodes.map((n) => [n.slot, n]));
  const max = Math.max(1, ...net.edges.map((e) => e.n));
  g.strokeStyle = color; g.lineCap = 'round';
  for (const e of net.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    g.globalAlpha = 0.25 + 0.65 * (e.n / max); g.lineWidth = 1 + 5 * (e.n / max);
    g.beginPath(); g.moveTo(X(W, a.x), Z(H, a.z)); g.lineTo(X(W, b.x), Z(H, b.z)); g.stroke();
  }
  g.globalAlpha = 1;
  const maxT = Math.max(1, ...net.nodes.map((n) => n.touches));
  g.font = 'bold 8px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const n of net.nodes) {
    const r = 6 + 5 * (n.touches / maxT);
    g.beginPath(); g.arc(X(W, n.x), Z(H, n.z), r, 0, Math.PI * 2);
    g.fillStyle = color; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = '#fff'; g.fillText(String(n.num), X(W, n.x), Z(H, n.z) + 0.5);
  }
}

// Build the whole analysis block (three rows of pitches and a small table) into `el`
export function renderAnalysis(el, game, doc = document) {
  const s = game.stats;
  if (!s || !s.players.size) { el.innerHTML = ''; return; }
  const colors = game.kits.outfield.map((k) => hexc(k.shirt)), codes = [game.teamCode(0), game.teamCode(1)];
  const canvas = (w, h, draw) => { const c = doc.createElement('canvas'); c.width = w * 2; c.height = h * 2; c.className = 'an-canvas'; const g = c.getContext('2d'); g.scale(2, 2); draw(g, w, h); return c; };
  const block = (title, ...nodes) => { const d = doc.createElement('div'); d.className = 'an-block'; const h = doc.createElement('h4'); h.textContent = title; d.appendChild(h); const row = doc.createElement('div'); row.className = 'an-row'; nodes.forEach((n) => row.appendChild(n)); d.appendChild(row); return d; };
  const label = (t, c) => { const w = doc.createElement('div'); w.className = 'an-cell'; const l = doc.createElement('em'); l.textContent = t; l.style.color = c; w.appendChild(l); return w; };
  const cell = (t, c, cv) => { const w = label(t, c); w.appendChild(cv); return w; };
  el.innerHTML = '';
  el.appendChild(block('Heat map (each team attacks to the right)', ...[0, 1].map((t) => cell(codes[t], colors[t], canvas(250, 160, (g, W, H) => drawHeat(g, W, H, s.heat[t], colors[t]))))));
  el.appendChild(block('Shots (star = goal, filled = on target, ring = off target)', cell(`${codes[0]} → · ← ${codes[1]}`, '#fff', canvas(510, 170, (g, W, H) => drawShots(g, W, H, s.shotLog, colors)))));
  el.appendChild(block('Passing network (circle size = touches, line width = passes)', ...[0, 1].map((t) => cell(codes[t], colors[t], canvas(250, 160, (g, W, H) => drawNetwork(g, W, H, passNetwork(s, t), colors[t]))))));
  const tbl = doc.createElement('div'); tbl.className = 'an-table';
  const col = (t) => `<div><h4 style="color:${colors[t]}">${codes[t]}</h4>
    <p>Distance covered: <b>${(teamDistance(s, t) / 1000).toFixed(1)} km</b></p>
    <p>Top passers: ${topPassers(s, t).map((r) => `#${r.num} ${r.name} ${r.ok}/${r.total} (${r.pct}%)`).join(' · ') || '–'}</p>
    <p>Most distance: ${topRunners(s, t).map((r) => `#${r.num} ${r.name} ${r.meters} m`).join(' · ') || '–'}</p></div>`;
  tbl.innerHTML = col(0) + col(1);
  el.appendChild(tbl);
}
