import { packCode, unpackCode } from './codec.js';

// A peer-to-peer link between two browsers (WebRTC data channels), set up by exchanging two short codes by hand.
// Two channels: 'ctl' (reliable, ordered: control messages, JSON) and 'fast' (unreliable: snapshots and inputs, binary).
// Same interface as LoopbackLink below, which the tests use instead of a real network.
export class PeerLink {
  constructor({ stun = false } = {}) {
    this.stun = stun;
    this.pc = null;
    this.ctl = null; this.fast = null;
    this.state = 'new'; // new | waiting | connecting | open | closed | failed
    this.onopen = () => {}; this.onclose = () => {}; this.onmessage = () => {}; this.onfast = () => {}; this.onstate = () => {};
    this._opened = 0;
    this.role = null; // 'host' | 'guest'
    this.inviteId = null; // ties a reply code to the invitation it answers
  }

  _setState(s) { if (this.state === s) return; this.state = s; this.onstate(s); }

  _make() {
    const iceServers = this.stun ? [{ urls: 'stun:stun.l.google.com:19302' }] : [];
    const pc = new RTCPeerConnection({ iceServers });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this._setState('failed');
      else if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') { if (this.state === 'open') { this._setState('closed'); this.onclose(); } }
    };
    this.pc = pc;
    return pc;
  }

  _wire(ch, kind) {
    ch.binaryType = 'arraybuffer';
    if (kind === 'ctl') { this.ctl = ch; ch.onmessage = (e) => { try { this.onmessage(JSON.parse(e.data)); } catch { /* ignore garbage */ } }; }
    else { this.fast = ch; ch.onmessage = (e) => this.onfast(e.data); }
    const opened = () => { if (++this._opened === 2) { this._setState('open'); this.onopen(); } };
    ch.onopen = opened;
    ch.onclose = () => { if (this.state === 'open') { this._setState('closed'); this.onclose(); } };
    if (ch.readyState === 'open') opened();
  }

  // Wait until the browser has found all its network addresses (candidates): they are part of the code we hand out.
  // Both the state event and the final empty candidate are watched; after a while we use what we have.
  async _gathered(pc) {
    if (pc.iceGatheringState === 'complete') return;
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); pc.removeEventListener('icecandidate', onCand); resolve(); };
      const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
      const onCand = (e) => { if (!e.candidate) finish(); };
      const timer = setTimeout(finish, 6000);
      pc.addEventListener('icegatheringstatechange', check);
      pc.addEventListener('icecandidate', onCand);
    });
  }

  // HOST step 1: create the invitation code to send to the friend
  async createInvitation() {
    this.role = 'host';
    this.inviteId = Math.random().toString(16).slice(2, 10);
    const pc = this._make();
    this._wire(pc.createDataChannel('ctl'), 'ctl');
    this._wire(pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }), 'fast');
    await pc.setLocalDescription(await pc.createOffer());
    await this._gathered(pc);
    this._setState('waiting');
    return packCode({ t: 'offer', id: this.inviteId, sdp: pc.localDescription.sdp });
  }

  // GUEST: read the invitation and create the reply code to send back
  async acceptInvitation(code) {
    const o = await unpackCode(code);
    if (o.t !== 'offer') throw new Error('This is a reply code, not an invitation.');
    this.role = 'guest';
    const pc = this._make();
    pc.ondatachannel = (e) => this._wire(e.channel, e.channel.label === 'ctl' ? 'ctl' : 'fast');
    await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await this._gathered(pc);
    this._setState('connecting');
    return packCode({ t: 'answer', id: o.id, sdp: pc.localDescription.sdp });
  }

  // HOST step 2: read the friend's reply; the link opens by itself a moment later
  async acceptReply(code) {
    if (this.role !== 'host' || !this.pc) throw new Error('Create an invitation first: this browser is not waiting for a reply.');
    const o = await unpackCode(code);
    if (o.t !== 'answer') throw new Error('This is an invitation, not a reply code.');
    if (o.id !== this.inviteId) throw new Error('This reply belongs to a different invitation. Use the reply to the invitation shown above, or create a new invitation and send it again.');
    if (this.pc.signalingState !== 'have-local-offer') throw new Error('This invitation has already been answered. If the connection did not open, create a new invitation and send it again.');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: o.sdp });
    this._setState('connecting');
  }

  get isOpen() { return this.state === 'open'; }
  send(obj) { if (this.ctl?.readyState === 'open') this.ctl.send(JSON.stringify(obj)); }
  // typed arrays are sent as plain ArrayBuffers (every WebRTC implementation accepts those)
  sendFast(buf) {
    if (this.fast?.readyState !== 'open') return;
    this.fast.send(ArrayBuffer.isView(buf) ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
  }
  close() { try { this.ctl?.close(); this.fast?.close(); this.pc?.close(); } catch { /* already closed */ } if (this.state !== 'closed') { this._setState('closed'); } }
}

// An in-memory pair of links for tests: messages are queued and delivered by pump()
export function makeLoopbackPair() {
  const mk = () => ({
    state: 'open', isOpen: true, q: [], peer: null,
    onopen() {}, onclose() {}, onmessage() {}, onfast() {}, onstate() {},
    send(obj) { this.peer.q.push(['ctl', JSON.parse(JSON.stringify(obj))]); },
    sendFast(buf) { this.peer.q.push(['fast', buf instanceof Float32Array ? buf.slice() : buf]); },
    pump() { const q = this.q; this.q = []; for (const [k, v] of q) (k === 'ctl' ? this.onmessage(v) : this.onfast(v)); return q.length; },
    close() { if (this.state === 'closed') return; this.state = 'closed'; this.isOpen = false; this.onclose(); if (this.peer.state !== 'closed') this.peer.close(); },
  });
  const a = mk(), b = mk();
  a.peer = b; b.peer = a;
  return [a, b];
}
