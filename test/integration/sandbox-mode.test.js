/**
 * SANDBOX ON OR OFF, ONE PRESS (sandbox-mode.js) — Design note, 2026-11-18, the switch locked ON behind an owner-at-the-desk
 * rule: […] What the desk declares stands, with no owner or desk test; a connection that declares nothing (a channel
 * speaking for someone outside the house) keeps the isolated start it is given. Real portal connections, a real frame.
 */
import { describe, expect, test } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { handlePortalMessage } from '../../backend/routes/portal-message-handlers.js';
import { portalConnections } from '../../backend/routes/portal-connections.js';
import { createPortalConnection } from '../../backend/services/portal-connection.js';
import { declareSandboxMode, directShellFor } from '../../backend/services/sandbox-mode.js';

const WALLET = '0x00000000000000000000000000000000000000a1';
const requestFor = (accessScope) => ({ walletAddress: WALLET, accessScope, headers: {} });

describe('sandbox:mode — what the desk declares stands', () => {
  test('OFF runs commands directly in the focused folder; ON isolates them; either way at one press, from any connection that declares it', async () => {
    for (const request of [requestFor('local'), requestFor('remote'), null]) {
      const connection = { httpRequest: request, sandboxEnabled: true };
      await expect(declareSandboxMode(connection, false)).resolves.toEqual({ enabled: false });
      expect(directShellFor(connection, { sourceRoot: '/tmp' })).toEqual({ sourceRoot: '/tmp', direct: true });
      await expect(declareSandboxMode(connection, true)).resolves.toEqual({ enabled: true });
      expect(directShellFor(connection, { sourceRoot: '/tmp' })).toBeNull();
    }
  });

  test('a connection that declares nothing keeps the isolated start it is given', () => {
    expect(createPortalConnection({ ws: null, walletAddress: WALLET }).sandboxEnabled).toBe(true);
    expect(directShellFor({ sandboxEnabled: true }, { sourceRoot: '/tmp' })).toBeNull();
  });

  test('a real portal frame turns it OFF and the server says so', async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise((resolve) => wss.once('listening', resolve));
    const client = new WebSocket(`ws://127.0.0.1:${wss.address().port}`);
    const serverSocket = await new Promise((resolve) => wss.once('connection', resolve));
    await new Promise((resolve) => client.once('open', resolve));
    const connectionId = 'sandbox-mode-wire';
    const connection = createPortalConnection({ ws: serverSocket, walletAddress: WALLET });
    connection.httpRequest = requestFor('local');
    portalConnections.set(connectionId, connection);
    const acknowledged = new Promise((resolve) => client.once('message', (raw) => resolve(JSON.parse(raw.toString()))));
    try {
      await handlePortalMessage(connectionId, { type: 'sandbox:mode', enabled: false }, { birthHandler: null });
      expect(await acknowledged).toMatchObject({ type: 'sandbox:mode', enabled: false });
      expect(connection.sandboxEnabled).toBe(false);
    } finally {
      portalConnections.delete(connectionId);
      client.close();
      await new Promise((resolve) => wss.close(resolve));
    }
  });
});
