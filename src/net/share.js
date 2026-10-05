import qrcode from 'qrcode-generator';

// Sharing a game by link / QR code: the host shows a QR code that holds the address of the game and the room (or the
// invitation code); the friend scans it with the phone camera and lands in the game, already joining.

// An SVG picture of the QR code for `text` (dark modules on a white quiet zone). Throws when the text is too long.
export function qrSvg(text, { margin = 2, level = 'M' } = {}) {
  let qr;
  for (const l of level === 'M' ? ['M', 'L'] : [level]) {
    try { qr = qrcode(0, l); qr.addData(text); qr.make(); break; } catch { qr = null; }
  }
  if (!qr) throw new Error('This text is too long for a QR code.');
  const n = qr.getModuleCount(), size = n + margin * 2;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + margin} ${y + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export const isLoopback = (host) => /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i.test(host || '');

// Candidate addresses of this game that a friend can open: where the page is served from, or - when it runs on
// localhost - the network addresses of this computer that the server reports (info = { port, addresses: [{ address }] }).
export function shareBases(loc, info) {
  const url = new URL(loc.href);
  url.search = ''; url.hash = '';
  if (!isLoopback(url.hostname)) return [{ label: url.host, base: url.toString() }];
  const port = info?.port || url.port;
  return (info?.addresses || []).map((a) => { const u = new URL(url); u.hostname = a.address; if (port) u.port = String(port); return { label: u.host, base: u.toString() }; });
}

export const joinLink = (base, room) => { const u = new URL(base); u.search = ''; u.hash = ''; u.searchParams.set('join', room); return u.toString(); };
export const inviteLink = (base, code) => { const u = new URL(base); u.search = ''; u.hash = `invite=${code}`; return u.toString(); };

// What a shared link asks for: { room } or { invite }, or null for an ordinary address
export function parseShareLink(href) {
  let u; try { u = new URL(href); } catch { return null; }
  const room = (u.searchParams.get('join') || '').toUpperCase();
  if (/^[A-Z0-9]{4,8}$/.test(room)) return { room };
  const m = /^#invite=(FB3D1\.[zr]\.[A-Za-z0-9_-]+)$/.exec(u.hash);
  return m ? { invite: m[1] } : null;
}
