/**
 * The culture media lane — REAL paths, no mock anywhere on a claimed path
 * (RULE 0): a REAL loopback Brave-shaped server behind the real request
 * code (the subscription token is asserted on the wire), the REAL guarded
 * fetch (loopback refusal offline-safe; a real image off the real internet
 * where the rig has egress), the REAL approval broker over a REAL
 * WebSocket pair, and the REAL library + queue + workspace on REAL tmp
 * disk.
 *
 * The env doors are the platform's own: NEUMA_BRAVE_API_ROOT aims the real
 * search code at the loopback server, NEUMA_MEDIA_LIBRARY_PATH points the
 * real store at the temp house, and the social paths isolate the queue.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import http, { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { searchImages } from '../../backend/services/web-search.js';
import { fetchMediaBytes } from '../../backend/services/media-fetch.js';
import { createMediaLibrary } from '../../backend/services/media-library.js';
import { mediaToolsFor, handleMediaTool, isMediaTool } from '../../backend/services/media-being-tools.js';
import { createWebSettings } from '../../backend/services/web-settings.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { usePositionHouse, ownLane, POSITION_HOUSE } from '../helpers/position-house.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { loadConfig, _resetConfig } from '../../backend/config.js';
import path from 'path';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { setMediaSaveSeams } from '../../backend/services/intents/media-save.js';
const NEUMA_ID = 'cultureecho';
const ENV_KEYS = [
  'BRAVE_SEARCH_API_KEY', 'NEUMA_BRAVE_API_ROOT', 'NEUMA_MEDIA_LIBRARY_PATH',
  'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH',
  'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SECTOR_CREW_PATH',
];

// A REAL png (magic header + payload — the sniff reads bytes, never names).
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  Buffer.alloc(128, 11),
]);

describe('the culture media lane (real loopback + real broker + real disk, gnosis)', () => {
  let house, origRoot, library, settings, positionHouse;
  let braveServer, lastBraveRequest;
  let httpServer, wss, serverWs, client, clientLog, decide;
  const savedEnv = {};

  const freshConnection = () => ({
    ws: serverWs,
    companion: { name: 'CultureEcho', neumaId: NEUMA_ID },
  });

  const mediaPorts = (connection) => ({
    sendToolEvent: (ws, c, ev) => ws.send(JSON.stringify({ type: 'tool:event', ...ev })),
    webSettings: settings,
    library,
  });

  // File a media/save intent exactly as the being does (a JSON write into its
  // own lane), then settle it through the REAL sweep.
  const fileMediaSave = async (connection, name, args) => {
    const dir = path.join(workspace.pathFor(connection.companion.neumaId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ type: 'media/save', ...args }));
  };
  const sweep = (connection, mode) => sweepIntents(connection, {
    mode, lanePolicy: null,
    emit: (event) => clientLog.push({ type: 'tool:usage', ...event }),
  });

  beforeAll(async () => {
    house = await createTempDir('culture-media-house');
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; }
    process.env.BRAVE_SEARCH_API_KEY = 'dummy-brave-key';
    process.env.NEUMA_MEDIA_LIBRARY_PATH = `${house}/media-library`;
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = `${house}/social-channel-bindings.json`;
    process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = `${house}/social-channel-credentials.json`;
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = `${house}/social-post-queue.json`;
    process.env.NEUMA_SECTOR_CREW_PATH = `${house}/sector-crew.json`;
    library = createMediaLibrary({ root: process.env.NEUMA_MEDIA_LIBRARY_PATH });
    settings = createWebSettings({ path: `${house}/web-access.json`, env: {} });
    await settings.setEnabled(true);
    // The intent's doors point at this suite's real tmp instances — the same
    // seams the tool's ports carried.
    setMediaSaveSeams({ settings, library });
    positionHouse = usePositionHouse(house);
    await channelBindings.bind(POSITION_HOUSE, 'x', { neumaId: NEUMA_ID });
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    await ownLane(NEUMA_ID);

    // The loopback Brave — the REAL request code calls it, the token is
    // asserted on the wire, the payload is Brave-shaped.
    braveServer = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://loopback');
      if (url.pathname === '/res/v1/images/search') {
        lastBraveRequest = {
          token: req.headers['x-subscription-token'] || null,
          query: url.searchParams.get('q'),
          count: url.searchParams.get('count'),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          results: [
            {
              title: 'void cat gif',
              url: 'https://example.com/posts/void-cat',
              thumbnail: { src: 'https://imgs.search.brave.com/thumb.jpg' },
              properties: { url: 'https://cdn.example.com/void-cat.gif', format: 'gif', width: 480, height: 270 },
            },
          ],
        }));
        return;
      }
      res.writeHead(404).end('{}');
    });
    await new Promise((r) => braveServer.listen(0, '127.0.0.1', r));
    process.env.NEUMA_BRAVE_API_ROOT = `http://127.0.0.1:${braveServer.address().port}`;
    _resetConfig();
    loadConfig();

    // The approval broker's WS pair (the platform's own test shape).
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    await new Promise((r) => httpServer.listen(0, r));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => {
        serverWs = ws;
        ws.on('message', (d) => {
          const m = JSON.parse(d.toString());
          if (m.type === 'tool:approval_response') resolveToolApproval(ws.__connection, m.id, m.decision);
        });
        resolve();
      });
    });
    client = new WebSocket(`ws://localhost:${httpServer.address().port}`);
    clientLog = [];
    decide = null;
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      clientLog.push(msg);
      if (msg.type === 'tool:approval_request' && decide) {
        client.send(JSON.stringify({ type: 'tool:approval_response', id: msg.id, decision: decide(msg) }));
      }
    });
    await linked;
  }, 60000);

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    _resetConfig();
    setMediaSaveSeams(null);
    vi.restoreAllMocks();
    client?.close();
    wss?.close();
    httpServer?.close();
    braveServer?.close();
    setWorkspacesRoot(origRoot);
    positionHouse?.restore();
    await fs.rm(house, { recursive: true, force: true });
  });

  // ---- 1. image search, for real ----

  test('image_search rides the REAL request path — the subscription token is on the wire, the rows normalize', async () => {
    const out = await searchImages('void cat gif', 6);
    expect(out.ok).toBe(true);
    expect(out.backend).toBe('brave');
    expect(lastBraveRequest.token).toBe('dummy-brave-key');
    expect(lastBraveRequest.query).toBe('void cat gif');
    expect(lastBraveRequest.count).toBe('6');
    const [r] = out.results;
    expect(r.url).toBe('https://cdn.example.com/void-cat.gif');
    expect(r.pageUrl).toBe('https://example.com/posts/void-cat');
    expect(r.contentType).toBe('gif');
  });

  // ---- 2. the guarded download ----

  test('the guard stands for BYTES exactly as for pages — a loopback image is never fetched', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(PNG);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const out = await fetchMediaBytes(`http://127.0.0.1:${server.address().port}/pic.png`);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/forbidden-host/);
    server.close();
  });

  test('a REAL image off the REAL internet lands as sniffed bytes (skips cleanly offline)', async () => {
    const online = await fetch('https://example.com', { signal: AbortSignal.timeout(4000) })
      .then((r) => r.ok).catch(() => false);
    if (!online) return;
    // A tiny, very stable public PNG (W3C's own icon).
    const out = await fetchMediaBytes('https://www.w3.org/Icons/w3c_home.png');
    expect(out.ok).toBe(true);
    expect(out.contentType).toBe('image/png');
    expect(out.bytes.length).toBeGreaterThan(100);
    expect(out.bytes.subarray(0, 8).equals(PNG.subarray(0, 8))).toBe(true);
  }, 30000);

  // ---- 3. the gates ----

  test('ADVERTISING — the read rides the switch and a bound being; the save is the intent now', async () => {
    expect((await mediaToolsFor({ companion: null }, settings)).length).toBe(0);
    expect((await mediaToolsFor(freshConnection(), settings)).map((t) => t.name)).toEqual(['media_library']);
    await settings.setEnabled(false);
    expect((await mediaToolsFor(freshConnection(), settings)).length).toBe(0);
    await settings.setEnabled(true);
    // isMediaTool hears both dialects of the read, and nothing else.
    expect(isMediaTool({ toolName: 'media_save' })).toBe(false);
    expect(isMediaTool({ tool: 'media/media_library' })).toBe(true);
    expect(isMediaTool({ toolName: 'web_fetch' })).toBe(false);
  });

  test('the library read is OBSERVATION — no chip, and it names every saved path', async () => {
    await library.save({ bytes: PNG, sourceUrl: 'https://cdn.example.com/a.png', alt: 'a test image', savedBy: 'CultureEcho' });
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = null; // no chip may even be asked
    const result = await handleMediaTool(serverWs, connection, null, 'ask', { toolName: 'media_library' }, {}, mediaPorts(connection));
    expect(result.status).toBe('ok');
    expect(result.content).toContain('path:');
    expect(result.content).toContain('a test image');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  });

  test('a media/save intent ASKS — and after the operator allows, the guard STILL refuses a loopback target', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';
    await fileMediaSave(connection, 'loopback-save', { url: 'http://127.0.0.1:9/never.png' });
    const receipts = await sweep(connection, 'ask');
    // The card really rode (the operator's allow resumed the settle), and the
    // answer is the GUARD's refusal, never a save.
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(true);
    expect(receipts[0].status).toBe('error');
    expect(receipts[0].error).toMatch(/forbidden-host|refused/);
    expect(await library.load()).toHaveLength(1); // only the media_library seed above
  });

  test('a DENY at the card saves nothing and fetches nothing', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'deny';
    await fileMediaSave(connection, 'denied-save', { url: 'https://cdn.example.com/void-cat.gif' });
    const receipts = await sweep(connection, 'ask');
    expect(receipts[0].status).toBe('denied');
    expect(await library.load()).toHaveLength(1);
  });

  test('END TO END — a real image downloads through the card into the library, journaled (skips offline)', async () => {
    const online = await fetch('https://example.com', { signal: AbortSignal.timeout(4000) })
      .then((r) => r.ok).catch(() => false);
    if (!online) return;
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';
    await fileMediaSave(connection, 'real-save', {
      url: 'https://www.w3.org/Icons/w3c_home.png', alt: 'a proving pattern',
    });
    const receipts = await sweep(connection, 'ask');
    expect(receipts[0].status).toBe('ok');
    expect(receipts[0].content).toContain('path:');
    const entries = await library.load();
    const landed = entries.find((e) => e.alt === 'a proving pattern');
    expect(landed).toBeTruthy();
    expect(landed.contentType).toBe('image/png');
    expect(landed.sourceUrl).toContain('w3.org');
    // The journal holds the reach — the reading list belongs to the record.
    const journal = await workspace.readJournal(NEUMA_ID).catch(() => null);
    if (journal) expect(JSON.stringify(journal)).toContain('media/save');
  }, 40000);

  // ---- 4. the attach seam ----

  test('a library image ATTACHES to a staged post — the library is trusted ground, no Explorer root needed', async () => {
    const saved = await library.save({ bytes: PNG, sourceUrl: 'https://cdn.example.com/b.png', alt: 'attachable culture', savedBy: 'CultureEcho' });
    const mediaPath = await library.pathFor(saved.entry.id);
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow'; // the staging card
    // Staging is a filed INTENT now (Stage 2) — the being writes the file,
    // the sweep settles it through the same card and the same queue store.
    const intentsDir = path.join(workspace.pathFor(NEUMA_ID), 'intents');
    await fs.mkdir(intentsDir, { recursive: true });
    await fs.writeFile(path.join(intentsDir, 'culture-attach.json'), JSON.stringify({
      type: 'social/queue',
      channel: 'x',
      text: 'the culture, attached',
      media: [{ path: mediaPath, alt: 'attachable culture' }],
    }));
    const receipts = await sweepIntents(connection, {
      mode: 'ask', lanePolicy: null,
      emit: (event) => clientLog.push({ type: 'tool:usage', ...event }),
    });
    expect(receipts[0].status).toBe('ok');
    const queue = await postQueue.load();
    const staged = queue.find((e) => e.text === 'the culture, attached\n\nMade with AI.');
    expect(staged).toBeTruthy();
    expect(staged.media).toHaveLength(1);
    expect(staged.media[0].path).toBe(mediaPath);
    expect(staged.media[0].alt).toBe('attachable culture');
  });
});
