// Saving a replay as a video: the WebGL canvas is recorded with MediaRecorder while the replay plays and the clip
// is downloaded when it ends. No sound (the 3D picture only) and no HUD overlays.
const TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

export const pickMimeType = (isSupported) => TYPES.find((t) => isSupported(t)) || '';
export const extensionFor = (mime) => (String(mime).includes('mp4') ? 'mp4' : 'webm');
export const clipName = (date = new Date(), ext = 'webm', what = 'goal') => {
  const p = (n) => String(n).padStart(2, '0');
  return `turbo-football-${what}-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.${ext}`;
};

export class ClipRecorder {
  // env lets the tests replace the browser APIs
  constructor(canvas, env = {}) {
    this.canvas = canvas;
    this.MR = env.MediaRecorder ?? (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null);
    this.download = env.download ?? ((blob, name) => {
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
    this.now = env.now ?? (() => new Date());
    this.rec = null; this.chunks = []; this.mime = '';
    this.onsaved = () => {}; this.onerror = () => {};
  }

  get supported() { return !!(this.MR && this.canvas?.captureStream); }
  get active() { return !!this.rec; }

  start(fps = 30) {
    if (!this.supported || this.rec) return false;
    try {
      const stream = this.canvas.captureStream(fps);
      this.mime = pickMimeType((t) => this.MR.isTypeSupported?.(t));
      const rec = new this.MR(stream, { ...(this.mime ? { mimeType: this.mime } : {}), videoBitsPerSecond: 6_000_000 });
      this.chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      rec.onerror = (e) => { this.rec = null; this.onerror(e); };
      rec.start(250);
      this.rec = rec;
      return true;
    } catch (e) { this.rec = null; this.onerror(e); return false; }
  }

  // Stop and download. Returns the file name (or '' when nothing was recorded).
  finish(what = 'goal') {
    const rec = this.rec;
    if (!rec) return Promise.resolve('');
    this.rec = null;
    return new Promise((resolve) => {
      rec.onstop = () => {
        if (!this.chunks.length) { resolve(''); return; }
        const blob = new Blob(this.chunks, { type: this.mime || 'video/webm' });
        const name = clipName(this.now(), extensionFor(this.mime), what);
        this.chunks = [];
        this.download(blob, name);
        this.onsaved(name);
        resolve(name);
      };
      try { rec.state !== 'inactive' ? rec.stop() : rec.onstop(); } catch { resolve(''); }
    });
  }
}
