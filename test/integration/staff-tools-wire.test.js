/**
 * THE HOUSE_STATE TOOL ON THE REAL DISPATCH PATH (RULE 0, the
 * tool-repeat-visibility pattern): a real signed socket, the real tool
 * dispatcher, the real computed fold — no model, no mock. The subject is the
 * OFFICE LAW at the wire: the seated Optio's lane advertises and receives
 * `house_state`; another lane sees neither the advertisement nor an answer.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import {
  staffToolsFor,
  isStaffTool,
  handleStaffTool,
} from '../../backend/services/portal-tools/staff-tools.js';
import { fileDispatch } from '../../backend/services/staff/dispatch-store.js';
import { WALLET, OPTIO, HOUSEMATE, createStaffOfficeFixture } from '../helpers/staff-office-fixture.js';

let fx;
let kit;

beforeEach(async () => {
  // The kit owns the workspaces root first; the fixture seeds into it.
  kit = await createHarnessTurnKit(OPTIO);
  fx = await createStaffOfficeFixture({ manageRoot: false });
  kit.connection.walletAddress = WALLET;
});

afterEach(async () => {
  await kit?.close();
  await fx?.teardown();
});

describe('house_state — the office instrument at the wire', () => {
  test('the officer\'s lane advertises both; a seated housemate reads the board only', async () => {
    expect(await staffToolsFor(kit.connection).then((t) => t.map((x) => x.name).sort()))
      .toEqual(['board_list', 'house_state']);

    // A seated housemate reads the shared board (house state) but never the
    // office's instrument.
    const housemateKit = { companion: { neumaId: HOUSEMATE }, walletAddress: WALLET };
    expect(await staffToolsFor(housemateKit).then((t) => t.map((x) => x.name))).toEqual(['board_list']);
  });

  test('the matcher answers only its own name, both dialects', () => {
    expect(isStaffTool({ toolName: 'house_state' })).toBe(true);
    expect(isStaffTool({ tool: 'staff/house_state' })).toBe(true);
    expect(isStaffTool({ toolName: 'campaign_list' })).toBe(false);
  });

  test('a real call answers with the real fold on a real socket', async () => {
    await fileDispatch(OPTIO, {
      v: 1,
      id: '2026-09-15T04-00-00-000Z',
      from: OPTIO,
      to: HOUSEMATE,
      title: 'Draft the ledger report',
      body: 'Done looks like: the report filed.',
      filedAt: '2026-09-15T04:00:00.000Z',
      dueAt: null,
      by: WALLET,
      postId: 'abc123',
      status: 'dispatched',
      ackAt: null,
      doneAt: null,
      note: '',
      lastCheckedAt: null,
    });

    const result = await handleStaffTool(kit.ws, kit.connection, null, 'auto', { toolName: 'house_state' }, {});

    expect(result.status).toBe('ok');
    expect(result.content).toContain('## HOUSE STATE');
    expect(result.content).toContain('Fixture House');
    expect(result.content).toContain('"Draft the ledger report"');
    // The tool event reaches the real socket asynchronously — wait for the
    // real frame, then assert exactly one ok chip.
    await untilHarness(() => kit.frames.some((f) => f.type === 'tool:usage' && f.tool === 'staff/house_state'));
    const chips = kit.frames.filter((f) => f.type === 'tool:usage' && f.tool === 'staff/house_state');
    expect(chips.length).toBe(1);
    expect(chips[0].status).toBe('ok');
  });

  test('unseating the office drops house_state; the refusal still stands', async () => {
    await fx.cosDesignation.clear(WALLET);
    expect(await staffToolsFor(kit.connection).then((t) => t.map((x) => x.name))).toEqual(['board_list']);

    const result = await handleStaffTool(kit.ws, kit.connection, null, 'auto', { toolName: 'house_state' }, {});
    // The gate answers through the ACTS path — the call never reaches the fold.
    expect(result.status).toBe('denied');
    expect(result.error).toContain('only the seated chief of staff');
  });
});
