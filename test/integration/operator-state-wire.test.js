/**
 * THE TWO OPERATOR STATES ON THE WIRE — the harness desk and the full desk of
 * ONE wallet never hear each other (RULE 0: the real portal, real wallet
 * auth, the real notification bus and its real on-disk log on a temp realm).
 *
 * Design note, 2026-10-14: […] Found live (harness-separation-live): a harness
 * turn's […] notice was fanned out to every desk of the wallet —
 * the full desk heard the harness, and a being's notice would reach a harness
 * desk. Now each notice belongs to the state of the lane that raised it
 * (core/runtime/operator-state.js); the operator's own (a disk warning) reach
 * both. The tray's opening history follows the same law.
 */
import { createServer } from 'http';
import path from 'path';
import WebSocket, { WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { createSessionToken, generateChallenge, verifySignature } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { notifyOperator, __resetCoalesce } from '../../backend/services/notification-bus.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setHarnessRoot } from '../../core/workspace/lane-grounds.js';
import { ensureHarnessLane } from '../../backend/services/harness-lane.js';
import { KIND, STANDING } from '../../core/runtime/notification-record.js';
import {
  connectionState, frameState, reachesState, recordState, declaredStateOf,
} from '../../core/runtime/operator-state.js';

const makeOperator = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return { address: keypair.address, token: createSessionToken(verifySignature(keypair.address, challenge, signature)) };
};

const settle = () => new Promise((resolve) => { setTimeout(resolve, 150); });

describe('operator states — the pure law', () => {
  it('a notice belongs to the state of the lane that raised it; the operator\'s reach both', () => {
    expect(recordState({ actor: { id: 'harness-0a1b2c3d' } })).toBe('harness');
    expect(recordState({ actor: { id: 'neuma-orrin' } })).toBe('full');
    expect(recordState({ actor: { id: 'witness-basunor' } })).toBe('full');
    expect(recordState({ actor: null })).toBeNull();
    expect(frameState({ type: 'notification:new', record: { actor: { id: 'harness-1' } } })).toBe('harness');
    expect(frameState({ type: 'storage:warning' })).toBeNull();
    expect(reachesState(null, 'harness')).toBe(true);
    expect(reachesState('full', 'harness')).toBe(false);
  });

  it('a desk is the state of the lane it binds — before that, the state it declared', () => {
    expect(connectionState({ companion: { neumaId: 'harness-1' }, declaredState: 'full' })).toBe('harness');
    expect(connectionState({ companion: { neumaId: 'neuma-orrin' }, declaredState: 'harness' })).toBe('full');
    expect(connectionState({ companion: null, declaredState: 'harness' })).toBe('harness');
    expect(connectionState({})).toBe('full');
    expect(declaredStateOf('harness')).toBe('harness');
    expect(declaredStateOf('anything-else')).toBe('full');
  });
});

describe('one wallet, a harness desk and a full desk, over the real portal', () => {
  let httpServer; let wss; let wsUrl; let tmp; let operator; let laneId; let savedRoutes;
  const open = [];

  const openDesk = async (state) => {
    const ws = new WebSocket(`${wsUrl}/?token=${encodeURIComponent(operator.token)}${state ? `&state=${state}` : ''}`);
    const received = [];
    ws.on('message', (data) => { try { received.push(JSON.parse(data.toString())); } catch { /* not ours */ } });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for portal:established')), 5000);
      ws.on('message', function onEstablished(data) {
        if (JSON.parse(data.toString()).type === 'portal:established') { clearTimeout(timer); ws.off('message', onEstablished); resolve(); }
      });
      ws.on('error', reject);
    });
    open.push(ws);
    return { ws, received };
  };

  const notices = (desk) => desk.received.filter((f) => f.type === 'notification:new').map((f) => f.record.title);
  const hydrated = async (desk) => {
    for (let i = 0; i < 40 && !desk.received.some((f) => f.type === 'notification:hydrate'); i += 1) await settle();
    return desk.received.find((f) => f.type === 'notification:hydrate');
  };

  beforeAll(async () => {
    tmp = await createTempDir('operator-state-wire');
    setRealmRoot(path.join(tmp, 'realm'));
    setWorkspacesRoot(path.join(tmp, 'house'));
    __resetCoalesce();
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    setupPortalRoutes(wss, { birthHandler: null });
    await new Promise((resolve) => { httpServer.listen(0, '127.0.0.1', resolve); });
    wsUrl = `ws://127.0.0.1:${httpServer.address().port}`;
    operator = await makeOperator();
    setHarnessRoot(path.join(tmp, 'harness'));
    savedRoutes = process.env.NEUMA_ROUTES_PATH;
    process.env.NEUMA_ROUTES_PATH = path.join(tmp, 'routes.json'); // the lane's route lands here, never in the real store
    ({ laneId } = await ensureHarnessLane(operator.address, { providerId: 'lm-studio', model: 'local-model' }));
  }, 20000);

  afterAll(async () => {
    for (const ws of open) ws.close();
    setWorkspacesRoot(null);
    setHarnessRoot(null);
    if (savedRoutes === undefined) delete process.env.NEUMA_ROUTES_PATH; else process.env.NEUMA_ROUTES_PATH = savedRoutes;
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it('live: the harness hears the harness, the full desk hears its beings, both hear the operator\'s own', async () => {
    const full = await openDesk('full');
    const harness = await openDesk('harness');
    const older = await openDesk(null); // a desk from before the states: the full platform
    await notifyOperator({
      wallet: operator.address, kind: KIND.turnDone, standing: STANDING.neuma,
      title: 'Orrin finished a turn', actor: { id: 'neuma-orrin', name: 'Orrin' }, ref: { sessionId: 's-orrin' },
    });
    await notifyOperator({
      // the shape notifyTurnEnded raises for a harness turn (portal-turn-rounds.js)
      wallet: operator.address, kind: KIND.turnDone, standing: STANDING.neuma,
      title: 'qwen finished a turn', actor: { id: laneId, name: 'qwen' }, ref: { sessionId: 's-harness' },
    });
    await notifyOperator({
      wallet: operator.address, kind: KIND.storageWarning, standing: STANDING.system, title: 'Disk is filling', ref: {},
    });
    await settle();
    expect(notices(full)).toEqual(['Orrin finished a turn', 'Disk is filling']);
    expect(notices(older)).toEqual(['Orrin finished a turn', 'Disk is filling']);
    expect(notices(harness)).toEqual(['qwen finished a turn', 'Disk is filling']);
  });

  it('a desk bound to the harness lane is the harness, whatever it declared', async () => {
    const desk = await openDesk('full');
    desk.ws.send(JSON.stringify({ type: 'companion:manifest', companion: 'harness', neumaId: laneId }));
    for (let i = 0; i < 40 && !desk.received.some((f) => f.type === 'companion:anchored'); i += 1) await settle();
    expect(desk.received.find((f) => f.type === 'companion:anchored')?.participantKind).toBe('harness');
    const before = notices(desk).length;
    await notifyOperator({
      wallet: operator.address, kind: KIND.turnDone, standing: STANDING.neuma,
      title: 'Orrin spoke again', actor: { id: 'neuma-orrin', name: 'Orrin' }, ref: {},
    });
    await settle();
    expect(notices(desk).slice(before)).toEqual([]);
  });

  it('the tray\'s opening history: each desk opens on its own state\'s past and the operator\'s', async () => {
    const full = await openDesk('full');
    const harness = await openDesk('harness');
    const fullTitles = (await hydrated(full)).records.map((r) => r.title);
    const harnessTitles = (await hydrated(harness)).records.map((r) => r.title);
    expect(fullTitles).toEqual(expect.arrayContaining(['Orrin finished a turn', 'Orrin spoke again', 'Disk is filling']));
    expect(fullTitles).not.toContain('qwen finished a turn');
    expect(harnessTitles).toEqual(expect.arrayContaining(['qwen finished a turn', 'Disk is filling']));
    expect(harnessTitles.filter((t) => t.includes('Orrin'))).toEqual([]);
    expect((await hydrated(harness)).unread).toBe(harnessTitles.length);
  });
});
