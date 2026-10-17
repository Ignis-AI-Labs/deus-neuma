/**
 * #200 — an approval answered AFTER the operator pulled the turn is consent to
 * a turn that no longer exists.
 *
 * An approval card can sit on screen as long as the operator takes. Six
 * handlers re-checked the abort signal after the wait; ten did not, so a task
 * add, a vault save, a memory note, a house post or a filesystem write could
 * land after the operator had already cancelled — their cancel silently did not
 * cancel.
 *
 * The guard now lives INSIDE the one gate (act-gate.js `gateAct`): every
 * handler the portal serves passes through it, so the re-check cannot be
 * forgotten at a call site. The two cards gateAct cannot express — the social
 * cancellation card (it carries a consent scope) and the MCP lane's one merged
 * card — are hand-composed and owe the same re-check; the structural audit
 * below re-derives that from source, so a NEW hand-composed card that forgets
 * the guard fails here rather than in someone's session.
 *
 * The unit tests drive the REAL gate with a REAL AbortController. No mocks.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

let gateAct;

beforeEach(async () => {
  vi.resetModules();
  ({ gateAct } = await import('../../backend/services/act-gate.js'));
});
afterEach(() => vi.restoreAllMocks());

// A plain policy input that resolves the tool to 'allowed' — the interrupt
// re-check is what is under test, so no card may fire.
const ALLOWING_DEFAULTS = Object.freeze({ tasks: Object.freeze({ allowed: ['task_add'] }) });

describe('the one gate re-checks the interrupt', () => {
  test('a live turn proceeds — the gate answers ok and says nothing', async () => {
    const events = [];
    const connection = { activeTurn: new AbortController(), companion: { name: 'Fenna', neumaId: 'fenna' } };
    const gate = await gateAct(connection, {
      server: 'tasks', tool: 'task_add', mode: 'ask', defaults: ALLOWING_DEFAULTS,
      emit: (e) => events.push(e),
    });
    expect(gate).toEqual({ ok: true });
    expect(events).toHaveLength(0);
  });

  test('an ABORTED turn is refused, and the being is told why', async () => {
    const events = [];
    const ctrl = new AbortController();
    const connection = { activeTurn: ctrl, companion: { name: 'Fenna', neumaId: 'fenna' } };
    ctrl.abort(); // the operator pulled the turn while the card waited

    const gate = await gateAct(connection, {
      server: 'tasks', tool: 'task_add', mode: 'ask', defaults: ALLOWING_DEFAULTS,
      emit: (e) => events.push(e),
    });

    expect(gate.ok).toBe(false);
    expect(gate.result).toEqual({
      tool: 'tasks/task_add',
      status: 'denied',
      error: 'the turn was interrupted before your operator decided',
    });
    // The desk sees the refusal too — a cancelled act must not look like a
    // silent one.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tool: 'tasks/task_add', status: 'denied' });
    expect(events[0].summary).toMatch(/turn interrupted/);
  });

  test('a connection with no active turn is not treated as aborted', async () => {
    const events = [];
    const noTurn = await gateAct({ companion: {} }, {
      server: 'tasks', tool: 'task_add', mode: 'ask', defaults: ALLOWING_DEFAULTS,
      emit: (e) => events.push(e),
    });
    expect(noTurn).toEqual({ ok: true });
    const bare = await gateAct({}, {
      server: 'tasks', tool: 'task_add', mode: 'ask', defaults: ALLOWING_DEFAULTS,
      emit: (e) => events.push(e),
    });
    expect(bare).toEqual({ ok: true });
    expect(events).toHaveLength(0);
  });
});

describe('EVERY approval card re-checks the abort — audited from source', () => {
  // Re-derives the audit that found this rather than trusting a fixed list, so
  // a card added tomorrow is held to the same law.
  test('no hand-composed card reaches its side effect without the check', async () => {
    // The audited surface is the whole decomposed portal seat (size-law
    // breakdown steps 1-12): the orchestrator plus the extracted catalog/
    // dispatch/loop siblings and every portal-tools family module. The law
    // is unchanged — only the file set widened with the decomposition.
    const { readdir } = await import('fs/promises');
    const toolsDir = path.join(process.cwd(), 'backend/services/portal-tools');
    const familyFiles = (await readdir(toolsDir)).filter((f) => f.endsWith('.js'))
      .map((f) => `backend/services/portal-tools/${f}`);
    const surface = [
      'backend/services/portal-stream.js',
      'backend/services/portal-tool-catalog.js',
      'backend/services/portal-tool-dispatch.js',
      'backend/services/portal-tool-loop.js',
      'backend/services/portal-tool-grants.js',
      'backend/services/portal-tool-result-store.js',
      ...familyFiles,
    ];
    const sources = await Promise.all(surface.map(async (rel) => ({
      rel, source: await fs.readFile(path.join(process.cwd(), rel), 'utf8'),
    })));

    // Exactly two cards are composed by hand — the social cancellation card
    // (a consent scope gateAct cannot express, portal-tools/social-read-tools)
    // and the MCP lane's one merged card (portal-tool-loop). Every other act
    // rides gateAct, where the re-check is internal; a THIRD hand-composed
    // card fails this audit until it is guarded or moved.
    const cards = sources.flatMap(({ rel, source }) => {
      const lines = source.split('\n');
      return lines
        .map((l, i) => (l.includes('await requestToolApproval(') ? { rel, i, lines } : null))
        .filter(Boolean);
    });
    expect(cards.length, 'the audit must find exactly the two hand-composed cards').toBe(2);

    const unguarded = cards
      .filter(({ i, lines }) => !lines.slice(i, i + 80).join('\n').includes('signal?.aborted'))
      .map(({ rel, i }) => `${rel} line ${i + 1}`);
    expect(unguarded, 'these cards can act after the operator cancelled').toEqual([]);

    // The migrated blocks: one gateAct call per governed handler. The floor
    // came down from 15 with the catalog cut (#414): `_handleOperatorTaskTool`
    // left with `operator_task_add`, whose act is the `tasks/operator-add`
    // intent now — the gate did not vanish, it moved to the sweep, which runs
    // the same tier check on the same policy. Lower this number only when a
    // handler genuinely retires, never to make a red test green.
    const gates = sources.flatMap(({ source }) => source.match(/\bgateAct\(/g) || []);
    expect(gates.length, 'the audit must actually find the migrated gates').toBeGreaterThanOrEqual(14);
  });
});
