/**
 * A chat's tools stand still for the whole chat (tool-hud.js): the WIRE is the
 * two doors on every turn, and the HUD's usual tools — the being's experience
 * as the chat opened — are kept for that chat (on disk, across reconnects and
 * restarts), so the prompt the model server cached holds. Real disk settings +
 * the production catalog path; no mocks.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  discloseTurnTools, disclosedNativeTools, stashBeingTurnCatalog, TOOL_DOORS,
} from '../../backend/services/being-tool-surface.js';
import { toOpenAITools } from '../../backend/services/tool-schema.js';
import { webToolsFor } from '../../backend/services/web-being-tools.js';
import { createWebSettings } from '../../backend/services/web-settings.js';
import { noteWorkingSetCall } from '../../backend/services/sitting-disclosure.js';

const wire = (connection) => JSON.stringify(toOpenAITools(disclosedNativeTools(connection)));
const hud = (connection) => (connection._turnUsualTools || []).map((tool) => `${tool.server}/${tool.name}`);

describe('a chat\'s tools stand still — the wire and the HUD', () => {
  let settings;
  const connection = { companion: { name: 'Metidar', neumaId: 'metidar', participantKind: 'neuma' }, toolMode: 'auto', _sessionToolPolicy: null, sessionId: 'chat-1' };
  const turnOf = async (c) => stashBeingTurnCatalog(c, [...TOOL_DOORS, ...await webToolsFor(c, settings)], []);
  const newTurn = async () => turnOf(connection);

  beforeEach(async () => {
    settings = createWebSettings({ path: path.join(await createTempDir('sitting-disclosure'), 'web-access.json'), env: {} });
    await settings.setEnabled(true);
    connection.sessionId = 'chat-1';
    connection.toolMode = 'auto';
  });

  it('the wire is byte-identical from turn to turn — a search never moves it', async () => {
    await newTurn();
    const opening = wire(connection);
    discloseTurnTools(connection, { query: 'web research' });
    expect(wire(connection)).toBe(opening);
    await newTurn();
    expect(wire(connection)).toBe(opening);
    expect(disclosedNativeTools(connection).map(({ name }) => name)).toEqual(['tool_search', 'call']);
  });

  it('a new chat opens with the being\'s experience; a chat already open never changes its HUD', async () => {
    connection.sessionId = 'chat-steady';
    await newTurn();
    const steady = hud(connection);
    // Elsewhere, the being uses a web tool — it becomes experience.
    const elsewhere = { ...connection, sessionId: 'chat-elsewhere' };
    await turnOf(elsewhere);
    noteWorkingSetCall(elsewhere, { tool: 'web/web_fetch' });
    const fresh = { ...connection, sessionId: 'chat-new' };
    await turnOf(fresh);
    expect(hud(fresh)).toContain('web/web_fetch');
    await newTurn();
    expect(hud(connection)).toEqual(steady);
  });

  it('the chat keeps its usual tools across a reconnect or a desk restart — kept on disk, in order', async () => {
    const seeded = { ...connection, sessionId: 'chat-seed' };
    await turnOf(seeded);
    noteWorkingSetCall(seeded, { tool: 'web/web_search' });
    connection.sessionId = 'chat-kept';
    await newTurn();
    const opened = hud(connection);
    expect(opened).toContain('web/web_search');
    const reconnected = { ...connection, _turnDisclosedToolIds: undefined, _turnCatalog: undefined, _turnUsualTools: undefined };
    await turnOf(reconnected);
    expect(hud(reconnected)).toEqual(opened);
    await new Promise((r) => setTimeout(r, 50)); // the kept list lands on disk off the hot path
    const kept = JSON.parse(await fs.readFile(process.env.NEUMA_CHAT_TOOLS_PATH, 'utf8'));
    expect(kept['metidar:chat-kept'].ids).toEqual(opened);
  });

  it('a remembered tool the gate now denies never shows in the HUD', async () => {
    const seeded = { ...connection, sessionId: 'chat-seed-2' };
    await turnOf(seeded);
    noteWorkingSetCall(seeded, { tool: 'web/web_search' });
    const observing = { ...connection, sessionId: 'chat-observe', toolMode: 'observe' }; // web acts are held in observe
    await turnOf(observing);
    const deniedWeb = observing._turnCatalog.filter((tool) => tool.server === 'web' && tool.access === 'denied').map((t) => `web/${t.name}`);
    expect(deniedWeb.length).toBeGreaterThan(0); // the premise: observe really holds them
    expect(hud(observing).filter((id) => deniedWeb.includes(id))).toEqual([]);
  });
});
