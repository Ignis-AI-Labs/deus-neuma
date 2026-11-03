/** Direct execution is an install-owner capability at the local desk. */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { handlePortalMessage } from '../../backend/routes/portal-message-handlers.js';
import { portalConnections } from '../../backend/routes/portal-connections.js';
import { createPortalConnection } from '../../backend/services/portal-connection.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { declareSandboxMode, directShellFor } from '../../backend/services/sandbox-mode.js';
import { DESK_REFUSAL, GUEST_REFUSAL } from '../../backend/services/install-owner.js';

const OWNER = '0x00000000000000000000000000000000000000a1';
const COOWNER = '0x00000000000000000000000000000000000000b2';
const GUEST = '0x00000000000000000000000000000000000000c3';

const requestFor = (walletAddress, accessScope = 'local') => ({ walletAddress, accessScope, headers: {} });
const connectionFor = (request) => ({ httpRequest: request, sandboxEnabled: true });

describe('sandbox:mode owner gate', () => {
  let priorRoot;

  beforeEach(async () => {
    priorRoot = process.env.NEUMA_DATA_ROOT;
    const dir = await createTempDir('sandbox-mode');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    await makeInstallOwner(OWNER, { coOwners: [COOWNER] });
  });

  afterEach(() => {
    if (priorRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = priorRoot;
  });

  test('owner and co-owner may switch direct execution OFF and isolation ON', async () => {
    for (const wallet of [OWNER, COOWNER]) {
      const connection = connectionFor(requestFor(wallet));
      await expect(declareSandboxMode(connection, false)).resolves.toEqual({ enabled: false });
      expect(directShellFor(connection, { sourceRoot: '/tmp' })).toEqual({ sourceRoot: '/tmp', direct: true });
      await expect(declareSandboxMode(connection, true)).resolves.toEqual({ enabled: true });
      expect(directShellFor(connection, { sourceRoot: '/tmp' })).toBeNull();
    }
  });

  test('a guest at the desk stays sandboxed and gets the real refusal', async () => {
    const connection = connectionFor(requestFor(GUEST));
    const verdict = await declareSandboxMode(connection, false);
    expect(verdict).toEqual({ enabled: true, error: GUEST_REFUSAL });
    expect(directShellFor(connection, { sourceRoot: '/tmp' })).toBeNull();
  });

  test('a remote owner and a synthetic channel connection stay sandboxed', async () => {
    const remote = connectionFor(requestFor(OWNER, 'remote'));
    expect(await declareSandboxMode(remote, false)).toEqual({ enabled: true, error: DESK_REFUSAL });
    const channel = connectionFor(null);
    expect(await declareSandboxMode(channel, false)).toEqual({ enabled: true, error: DESK_REFUSAL });
  });

  const wireVerdict = async (wallet) => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise((resolve) => wss.once('listening', resolve));
    const client = new WebSocket(`ws://127.0.0.1:${wss.address().port}`);
    const serverSocket = await new Promise((resolve) => wss.once('connection', resolve));
    await new Promise((resolve) => client.once('open', resolve));
    const connectionId = 'sandbox-mode-wire';
    const connection = createPortalConnection({ ws: serverSocket, walletAddress: wallet });
    connection.httpRequest = requestFor(wallet);
    portalConnections.set(connectionId, connection);
    const acknowledged = new Promise((resolve) => client.once('message', (raw) => resolve(JSON.parse(raw.toString()))));
    try {
      await handlePortalMessage(connectionId, { type: 'sandbox:mode', enabled: false }, { birthHandler: null });
      return await acknowledged;
    } finally {
      portalConnections.delete(connectionId);
      client.close();
      await new Promise((resolve) => wss.close(resolve));
    }
  };

  test('a real portal frame returns the server-acknowledged owner and guest states', async () => {
    expect(await wireVerdict(OWNER)).toMatchObject({ type: 'sandbox:mode', enabled: false });
    expect(await wireVerdict(GUEST)).toMatchObject({ type: 'sandbox:mode', enabled: true, error: GUEST_REFUSAL });
  });
});
