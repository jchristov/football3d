// Invitation / reply codes for peer-to-peer play without a server: the WebRTC session description is packed into a short
// text that the players exchange by hand (chat, mail ...). The text is deflate-compressed when the browser can do it.
const PREFIX = 'FB3D1';

const toB64Url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (str) => {
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

async function pipe(bytes, stream) {
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {}); // a damaged code fails when reading; the writer side must not report it again
  writer.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

const canZip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined';

// obj (JSON-able) -> "FB3D1.z.<base64url>"
export async function packCode(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (canZip()) {
    try { return `${PREFIX}.z.${toB64Url(await pipe(raw, new CompressionStream('deflate-raw')))}`; } catch { /* fall through */ }
  }
  return `${PREFIX}.r.${toB64Url(raw)}`;
}

// The reverse; throws a readable error for anything that is not a code made by packCode
export async function unpackCode(text) {
  const clean = String(text || '').replace(/\s+/g, '');
  const m = /^FB3D1\.([zr])\.([A-Za-z0-9_-]+)$/.exec(clean);
  if (!m) throw new Error('This is not a valid invitation code.');
  try {
    let bytes = fromB64Url(m[2]);
    if (m[1] === 'z') {
      if (!canZip()) throw new Error('This browser cannot read compressed codes.');
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    throw new Error(e.message.includes('browser') ? e.message : 'The code is damaged or incomplete (copy it completely).');
  }
}
