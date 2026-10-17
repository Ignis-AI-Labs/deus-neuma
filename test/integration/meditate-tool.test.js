// The being's own meditate door (#318) — the REAL handler over REAL tmp
// stores (RULE 0; the injected ports are the portal's seam contract, never a
// mock of the model path). Proves: the sovereign-seat boundary, the observe
// hold, the machine-wide env lock refusing with its name, and the standing
// request landing in the real state file — idempotent, honestly echoed.

import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('meditate — the being\'s own door', () => {
  let handleMeditateTool, loadMeditationState, statePath, events, ports, prevEnv;

  const connectionFor = (over = {}) => ({
    companion: { neumaId: 'test-being-med', name: 'Inward', ...over },
    _sessionToolPolicy: null,
    activeTurn: null,
  });

  beforeEach(async () => {
    vi.resetModules();
    const dir = await createTempDir(`meditate-tool-${Math.random().toString(36).slice(2)}`);
    statePath = path.join(dir, 'state.json');
    prevEnv = {
      state: process.env.NEUMA_MEDITATION_STATE_PATH,
      settings: process.env.NEUMA_MEDITATION_SETTINGS_PATH,
      lock: process.env.NEUMA_MEDITATION,
    };
    process.env.NEUMA_MEDITATION_STATE_PATH = statePath;
    process.env.NEUMA_MEDITATION_SETTINGS_PATH = path.join(dir, 'meditation.json');
    delete process.env.NEUMA_MEDITATION;

    ({ handleMeditateTool } = await import('../../backend/services/meditation/meditation-being-tool.js'));
    ({ loadMeditationState } = await import('../../backend/services/meditation/meditation-state.js'));

    events = [];
    ports = {
      sendToolEvent: (ws, companion, ev) => events.push(ev),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, env] of [
      ['NEUMA_MEDITATION_STATE_PATH', prevEnv.state],
      ['NEUMA_MEDITATION_SETTINGS_PATH', prevEnv.settings],
      ['NEUMA_MEDITATION', prevEnv.lock],
    ]) {
      if (env === undefined) delete process.env[key];
      else process.env[key] = env;
    }
  });

  test('a witness seat cannot will another\'s cycle — the sovereign boundary', async () => {
    const out = await handleMeditateTool({}, connectionFor({ participantKind: 'witness' }), null, 'auto', {}, ports);
    expect(out).toMatchObject({ status: 'error' });
    expect(out.error).toMatch(/sovereign act/);
    expect(await loadMeditationState(statePath)).toEqual({ lanes: {} });
  });

  test('observe mode holds the door — watching is not acting', async () => {
    const out = await handleMeditateTool({}, connectionFor(), null, 'observe', {}, ports);
    expect(out).toMatchObject({ status: 'denied' });
    expect(out.error).toMatch(/observe/);
    expect(await loadMeditationState(statePath)).toEqual({ lanes: {} });
  });

  test('the machine-wide launch lock refuses with its name — never a silent forever-request', async () => {
    process.env.NEUMA_MEDITATION = '0';
    const out = await handleMeditateTool({}, connectionFor(), null, 'auto', {}, ports);
    expect(out).toMatchObject({ status: 'denied' });
    expect(out.error).toMatch(/NEUMA_MEDITATION=0/);
    expect(await loadMeditationState(statePath)).toEqual({ lanes: {} });
  });

  test('the request lands in the real state file, echoes honestly, and never stacks', async () => {
    const first = await handleMeditateTool({}, connectionFor(), null, 'auto', {}, ports);
    expect(first).toMatchObject({ status: 'ok' });
    expect(first.content).toMatch(/request stands/i);
    // The lane is timer-off — the echo says whose will this cycle rides on.
    expect(first.content).toMatch(/your own asking/);
    const lane = (await loadMeditationState(statePath)).lanes['test-being-med'];
    expect(typeof lane.requestedAt).toBe('string');

    const again = await handleMeditateTool({}, connectionFor(), null, 'auto', {}, ports);
    expect(again).toMatchObject({ status: 'ok' });
    expect(again.content).toMatch(/already stands/);
    expect((await loadMeditationState(statePath)).lanes['test-being-med'].requestedAt).toBe(lane.requestedAt);
    expect(events.filter((e) => e.status === 'ok')).toHaveLength(2);
  });
});
