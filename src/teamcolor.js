import { TEAMS } from './teams.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mix = (c, k) => [16, 8, 0].map((sh) => Math.round(((c >> sh) & 255) * (1 - k) + 255 * k));

// The team colour as readable text on the dark overlays: dark kits are lightened a little
export function teamTextColor(idx) {
  const c = TEAMS[idx].home, lum = (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
  const [r, g, b] = mix(c, lum < 0.55 ? 0.3 : 0);
  return `rgb(${r},${g},${b})`;
}

// A team name as a coloured HTML span
export const tn = (idx) => `<span class="tn" style="color:${teamTextColor(idx)}">${esc(TEAMS[idx].name)}</span>`;

// Plain text -> safe HTML in which every team name (and only the name) is shown in that team's colour
export function tint(text) {
  const names = TEAMS.map((t) => t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return esc(text).replace(new RegExp(names, 'g'), (m) => tn(TEAMS.findIndex((t) => t.name === m)));
}
