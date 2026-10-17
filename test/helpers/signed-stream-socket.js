/** Real signed wallet, loopback portal socket and wire-drain barrier. */
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { generateChallenge, verifySignature, createSessionToken, verifySessionToken } from '../../backend/services/auth.js';

/** impure — owns sockets only; does not alter workspace or provider configuration. */
export const createSignedStreamSocket = async (wallet) => {
  const challenge = generateChallenge(wallet.address);
  const signature = await wallet.signMessage(challenge);
  const token = createSessionToken(verifySignature(wallet.address, challenge, signature));
  const server = createServer();
  const wss = new WebSocketServer({ server });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const connected = once(wss, 'connection');
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/?token=${encodeURIComponent(token)}`);
  const opened = once(client, 'open');
  const frames = [];
  client.on('message', (data) => frames.push(JSON.parse(data.toString())));
  const [ws, request] = await connected;
  const session = verifySessionToken(new URL(request.url, 'http://localhost').searchParams.get('token'));
  await opened;
  const close = async () => {
    client.terminate(); ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  };
  if (!session) { await close(); throw new Error('Signed stream socket authentication failed'); }
  return {
    ws, client, frames, walletAddress: session.address, close,
    drain: async () => {
      // A pong follows all earlier data frames on this connection.
      const pong = once(ws, 'pong', { signal: AbortSignal.timeout(3000) });
      ws.ping();
      await pong;
    },
  };
};
