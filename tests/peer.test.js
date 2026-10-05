import test from 'node:test';
import assert from 'node:assert/strict';
import { PeerLink } from '../src/net/peer.js';

// A minimal RTCPeerConnection that follows the real signalling state machine (enough to test our own checks)
class FakePC {
  constructor() { this.signalingState = 'stable'; this.iceGatheringState = 'complete'; this.localDescription = null; this.remoteDescription = null; this.connectionState = 'new'; }
  createDataChannel(label) { return { label, readyState: 'connecting', close() {} }; }
  async createOffer() { return { type: 'offer', sdp: 'v=0 offer ' + Math.random() }; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0 answer ' + Math.random() }; }
  async setLocalDescription(d) { this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async setRemoteDescription(d) {
    if (d.type === 'answer' && this.signalingState !== 'have-local-offer') throw new Error('Failed to set remote answer sdp: Called in wrong state: ' + this.signalingState);
    this.remoteDescription = d; this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  addEventListener() {} removeEventListener() {} close() {}
}
globalThis.RTCPeerConnection = FakePC;

test('the normal flow: invitation, reply, connect', async () => {
  const host = new PeerLink(), guest = new PeerLink();
  const invite = await host.createInvitation();
  const reply = await guest.acceptInvitation(invite);
  await host.acceptReply(reply);
  assert.equal(host.state, 'connecting'); assert.equal(host.pc.signalingState, 'stable');
});

test('a reply is accepted only once: a second Connect gives a clear message, not the browser\'s "wrong state" error', async () => {
  const host = new PeerLink(), guest = new PeerLink();
  const reply = await guest.acceptInvitation(await host.createInvitation());
  await host.acceptReply(reply);
  await assert.rejects(host.acceptReply(reply), /already been answered.*new invitation/);
});

test('a reply that belongs to another invitation is recognised', async () => {
  const host = new PeerLink(), other = new PeerLink(), guest = new PeerLink();
  const oldInvite = await other.createInvitation();
  await host.createInvitation(); // the host created a newer invitation
  const replyToOld = await guest.acceptInvitation(oldInvite);
  await assert.rejects(host.acceptReply(replyToOld), /different invitation/);
  assert.equal(host.pc.signalingState, 'have-local-offer', 'the pending invitation is untouched and can still be answered');
});

test('without an invitation (or as the friend) Connect explains what to do', async () => {
  const fresh = new PeerLink();
  await assert.rejects(fresh.acceptReply('FB3D1.r.e30'), /Create an invitation first/);
  const guest = new PeerLink(), host = new PeerLink();
  const reply = await guest.acceptInvitation(await host.createInvitation());
  await assert.rejects(guest.acceptReply(reply), /Create an invitation first/, 'a browser that answered an invitation cannot also accept a reply');
});

test('invitation and reply codes cannot be mixed up', async () => {
  const host = new PeerLink(), guest = new PeerLink();
  const invite = await host.createInvitation();
  const reply = await guest.acceptInvitation(invite);
  await assert.rejects(new PeerLink().acceptInvitation(reply), /reply code, not an invitation/);
  const host2 = new PeerLink(); await host2.createInvitation();
  await assert.rejects(host2.acceptReply(invite), /invitation, not a reply/);
});
