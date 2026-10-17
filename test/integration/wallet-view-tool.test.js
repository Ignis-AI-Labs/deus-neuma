/**
 * The being's wallet view over the real path: real workspace files, real Base
 * RPC, real portal tool dispatch, and a real WebSocket pair. No mocked boundary.
 */
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import fs from 'fs/promises';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getBalance, getWalletView } from '../../backend/services/neuma-wallet.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { processToolCalls } = __test;
const NEUMA_ID = 'walletviewecho';
const RECIPIENT = '0x1111111111111111111111111111111111111111';

describe('wallet_view (real workspace + Base RPC + portal dispatch)', () => {
  let root;
  let originalRoot;
  let httpServer;
  let wss;
  let serverWs;
  let client;
  let clientMessages;
  let address;

  beforeAll(async () => {
    root = await createTempDir('wallet-view-tool');
    originalRoot = getWorkspacesRoot();
    setWorkspacesRoot(root);
    await workspace.create(NEUMA_ID);

    address = ethers.Wallet.createRandom().address;
    await workspace.writeKeypair(NEUMA_ID, { address });
    await workspace.writeSpendAllowlist(NEUMA_ID, {
      version: 1,
      entries: [{ address: RECIPIENT, label: 'house treasury', addedAt: new Date().toISOString() }],
    });
    await workspace.writeSpendThreshold(NEUMA_ID, { thresholdEth: 0 });
    await workspace.writePendingSpends(NEUMA_ID, [{
      id: 'pending-one',
      to: RECIPIENT,
      value: '0.01',
      memo: 'infrastructure',
      nonce: 'real-workspace-nonce',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      requestedAt: new Date().toISOString(),
      status: 'pending',
    }]);

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => { serverWs = ws; resolve(); });
    });
    clientMessages = [];
    client = new WebSocket(`ws://localhost:${port}`);
    client.on('message', (data) => clientMessages.push(JSON.parse(data.toString())));
    await linked;
  }, 60000);

  afterAll(async () => {
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(originalRoot);
    await fs.rm(root, { recursive: true, force: true });
  });

  test('reads the actual Base balance and witness policy without consuming a key', async () => {
    const balance = await getBalance(NEUMA_ID, { network: 'base' });
    expect(typeof balance).toBe('string');

    const view = await getWalletView(NEUMA_ID);
    expect(view).toMatchObject({
      network: 'base',
      address,
      balanceEth: balance,
      signingReady: false,
      autonomousThresholdEth: 0,
    });
    expect(view.approvedRecipients).toEqual([{ address: RECIPIENT, label: 'house treasury' }]);
    expect(view.pendingRequests[0]).toMatchObject({ id: 'pending-one', value: '0.01' });
  }, 30000);

  test('returns the real wallet state through observe-mode portal dispatch', async () => {
    clientMessages.length = 0;
    const results = await processToolCalls(
      serverWs,
      '[TOOL: wallet/wallet_view {}]',
      { ws: serverWs, companion: { name: 'WalletViewEcho', neumaId: NEUMA_ID }, toolMode: 'observe', _writeOps: 0 },
    );

    expect(results).toHaveLength(1);
    expect(results[0].tool).toBe('wallet/view');
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain(address);
    expect(results[0].content).toContain('house treasury');
    expect(results[0].content).toContain('pending-one');

    const started = Date.now();
    while (!clientMessages.some((message) => message.tool === 'wallet/view')) {
      if (Date.now() - started > 5000) throw new Error('wallet view event never reached the client');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(clientMessages.find((message) => message.tool === 'wallet/view').status).toBe('ok');
  }, 30000);
});
