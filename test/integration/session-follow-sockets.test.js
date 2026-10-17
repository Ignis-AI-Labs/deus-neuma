import { it, expect } from 'vitest';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Wallet } from 'ethers';
import { createSessionFollow } from '../../backend/services/session-follow.js';
import { generateChallenge, verifySignature, createSessionToken } from '../../backend/services/auth.js';

it('real signed sockets follow only their wallet and sitting', async () => {
  const tokenFor = async () => {
    const wallet = Wallet.createRandom();
    const challenge = generateChallenge(wallet.address);
    return createSessionToken(verifySignature(wallet.address, challenge, await wallet.signMessage(challenge)));
  };
  const token = await tokenFor(), otherToken = await tokenFor();
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const follow = createSessionFollow();
  const peers = [], clients = [];
  wss.on('connection', (ws, req) => { follow.admit(ws, req); peers.push(ws); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const wait = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Socket condition did not arrive');
  };
  const open = async (auth, sessionId) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws?token=${encodeURIComponent(auth)}`);
    const messages = [];
    clients.push(ws);
    ws.on('message', (raw) => messages.push(JSON.parse(raw)));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ type: 'portal:resume', neumaId: 'protocol-input-lane', sessionId }));
    return { ws, messages };
  };
  try {
    const phone = await open(token, 's1'), desk = await open(token, 's1');
    const other = await open(token, 's2'), stranger = await open(otherToken, 's1');
    // These are the follower's real protocol inputs, not a substitute model.
    // A ping round trip proves all preceding binding inputs reached the socket.
    for (const client of clients) {
      const pong = new Promise((resolve) => client.once('pong', resolve)); client.ping(); await pong;
    }
    const incoming = new Promise((resolve) => peers[0].once('message', resolve));
    phone.ws.send(JSON.stringify({ type: 'consciousness:stream', thought: 'protocol input' }));
    await incoming;
    peers[0].send(JSON.stringify({ type: 'tool:usage', tool: 'protocol-input' }));
    peers[0].send(JSON.stringify({ type: 'consciousness:complete', sessionId: 's1' }));
    await wait(() => desk.messages.length === 2 && phone.messages.length === 2);
    expect(desk.messages.map((m) => m.phase)).toEqual(['started', 'settled']);
    expect(other.messages).toEqual([]); expect(stranger.messages).toEqual([]);
  } finally {
    for (const ws of clients) ws.terminate();
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});
