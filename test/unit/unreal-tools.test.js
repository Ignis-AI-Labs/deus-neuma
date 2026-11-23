// The Unreal tool family (backend/services/unreal/): the pure parts, the policy rows, the switch and
// the seat. RULE 0: real modules, the real policy table, the real switch file on a temp dir; nothing
// is mocked. What needs a live editor is proven by the bridge probe (a hand run, kept private), not here.
import { afterEach, describe, expect, test } from 'vitest';
import {
  MARK, pyString, statusScript, screenshotScript, toolsetScript, toolAccessScript, toolStartScript, toolPollScript,
  logLines, markedAnswer, openToolAnswer, windowOf, renderWindow, unrealPort,
} from '../../backend/services/unreal/unreal-scripts.js';
import {
  UNREAL_TOOLS, UNREAL_CONNECTION, EPIC_READ, isUnrealTool, unrealToolsFor, handleUnrealTool,
  fabInstallArgs, fabLibraryArgs, pictureSide,
} from '../../backend/services/unreal/unreal-being-tools.js';
import { createUnrealRemote } from '../../backend/services/unreal/unreal-remote.js';
import { GLOBAL_DEFAULTS } from '../../backend/services/tool-policy-defaults.js';
import { isAutoHardGated } from '../../backend/services/protocol-guard.js';
import connections from '../../electron/connections.cjs';
import { connectionsOn } from '../helpers/connections-kit.js';

const neuma = { companion: { neumaId: 'neuma-orrin', name: 'Orrin' } };
const witness = { companion: { neumaId: 'witness-xai-Basunor', participantKind: 'witness' } };
let restore = null;
afterEach(() => { if (restore) restore(); restore = null; });

describe('the Python the wire sends', () => {
  test('any text becomes one Python string literal, quotes and newlines included', () => {
    expect(pyString('a "b"\n\\c')).toBe('"a \\"b\\"\\n\\\\c"');
    expect(pyString(undefined)).toBe('""');
  });
  test('each script says its answer on one marked line', () => {
    for (const script of [statusScript(), toolsetScript('A.B'), toolAccessScript('A.B', 'C'), toolPollScript('k')]) {
      expect(script).toContain(`print(${JSON.stringify(MARK)} + json.dumps(`);
    }
  });
  test('a picture request carries whole pixel sizes and the path as a literal', () => {
    const script = screenshotScript('/var/tmp/x "y".png', 1280.7, '720');
    expect(script).toContain('take_high_res_screenshot(1280, 720, "/var/tmp/x \\"y\\".png")');
  });
  test('a tool call sends its inputs as JSON text inside a Python literal', () => {
    const script = toolStartScript('_k', 'FabToolset.FabToolset', 'SearchFabMyLibrary', { Keywords: 'bed "room"' });
    expect(script).toContain('execute_tool("FabToolset.FabToolset", "SearchFabMyLibrary", "{\\"Keywords\\":\\"bed \\\\\\"room\\\\\\"\\"}")');
    expect(toolStartScript('_k', 'A', 'B')).toContain('"{}"');
  });
  test('the access lookup matches Epic\'s full tool name and the short one', () => {
    expect(toolAccessScript('FabToolset.FabToolset', 'FabSignIn')).toContain('full = "FabToolset.FabToolset.FabSignIn"');
  });
});

describe('what comes back', () => {
  test('log lines keep the editor\'s error and warning marks', () => {
    expect(logLines([{ Type: 'Info', Output: 'a\n' }, { Type: 'Error', Output: 'b' }, { Type: 'Warning', Output: 'c' }])).toEqual(['a', '! b', '~ c']);
    expect(logLines(undefined)).toEqual([]);
  });
  test('the marked line is the answer; none, or one that is not JSON, is no answer', () => {
    expect(markedAnswer(['noise', `${MARK}{"engine":"5.9"}`])).toEqual({ engine: '5.9' });
    expect(markedAnswer(['noise'])).toBeUndefined();
    expect(markedAnswer([`${MARK}{broken`])).toBeUndefined();
  });
  test('Epic\'s wrapped answer is opened; anything else is left as it came', () => {
    expect(openToolAnswer('{"returnValue":"{\\"results\\":[1]}"}')).toEqual({ returnValue: { results: [1] } });
    expect(openToolAnswer('{"returnValue":"plain words"}')).toEqual({ returnValue: 'plain words' });
    expect(openToolAnswer('not json')).toBe('not json');
  });
  test('a long text is read in windows that add up to the whole, each saying what is left', () => {
    const whole = 'x'.repeat(30_000);
    const first = windowOf(whole);
    expect([first.from, first.end, first.total, first.more]).toEqual([0, 12_000, 30_000, true]);
    expect(renderWindow(first).endsWith('[characters 0–12000 of 30000; unreal_more {from: 12000} reads on]')).toBe(true);
    const parts = [first, windowOf(whole, first.end), windowOf(whole, 24_000)];
    expect(parts.map((p) => p.text).join('')).toBe(whole);
    expect(renderWindow(parts[2]).endsWith('[characters 24000–30000 of 30000; the end]')).toBe(true);
    expect(renderWindow(windowOf('short'))).toBe('short');
    expect(windowOf('short', 99).text).toBe('');
  });
});

describe('where the wire points', () => {
  test('Unreal\'s own port unless the operator names another; a bad value falls back', () => {
    expect(unrealPort({})).toBe(30010);
    expect(unrealPort({ NEUMA_UNREAL_PORT: '30011' })).toBe(30011);
    expect(unrealPort({ NEUMA_UNREAL_PORT: 'no' })).toBe(30010);
    expect(unrealPort({ NEUMA_UNREAL_PORT: '70000' })).toBe(30010);
  });
  test('the host is this computer, whatever the environment says', () => {
    expect(createUnrealRemote({ env: { NEUMA_UNREAL_PORT: '30011', NEUMA_UNREAL_HOST: '10.0.0.5' } }).endpoint()).toBe('http://127.0.0.1:30011');
  });
  test('with no editor on the port, the wire says so (a real refused connection)', async () => {
    const remote = createUnrealRemote({ env: { NEUMA_UNREAL_PORT: '1' } });
    await expect(remote.status()).rejects.toMatchObject({ code: 'UNREAL_DOWN' });
  });
});

describe('policy', () => {
  test('every tool has a row: looks are allowed, acts ask', () => {
    const { allowed, requireApproval } = GLOBAL_DEFAULTS.unreal;
    for (const tool of UNREAL_TOOLS) expect(allowed.includes(tool.name) !== requireApproval.includes(tool.name), tool.name).toBe(true);
    expect(requireApproval).toEqual(['unreal_python', 'unreal_tool', 'unreal_fab_install']);
    expect(allowed).toContain(EPIC_READ);
  });
  test('the three acts pause on the card even in AUTO; the looks do not', () => {
    for (const tool of ['unreal_python', 'unreal_tool', 'unreal_fab_install']) expect(isAutoHardGated('unreal', tool), tool).toBe(true);
    for (const tool of ['unreal_status', 'unreal_look', 'unreal_toolsets', 'unreal_fab_library', 'unreal_more', EPIC_READ]) expect(isAutoHardGated('unreal', tool), tool).toBe(false);
  });
});

describe('the switch and the seat', () => {
  test('the connection is in the list, switched, and starts off', () => {
    const row = connections.CONNECTIONS.find((c) => c.id === UNREAL_CONNECTION);
    expect([row.control, row.default]).toEqual(['switch', false]);
  });
  test('off: nothing is advertised. On: a neuma is offered the family, a witness never', () => {
    ({ restore } = connectionsOn([]));
    expect(unrealToolsFor(neuma)).toEqual([]);
    restore();
    ({ restore } = connectionsOn([UNREAL_CONNECTION]));
    expect(unrealToolsFor(neuma).map((t) => t.name)).toEqual(UNREAL_TOOLS.map((t) => t.name));
    expect(unrealToolsFor(witness)).toEqual([]);
    expect(unrealToolsFor({ companion: {} })).toEqual([]);
  });
  test('a call that arrives with the switch off is refused, naming the switch, before any network', async () => {
    ({ restore } = connectionsOn([]));
    const events = [];
    const out = await handleUnrealTool(null, neuma, null, 'default', { toolName: 'unreal_python' }, { code: 'print(1)' }, { sendToolEvent: (_ws, _companion, event) => events.push(event) });
    expect(out.status).toBe('unavailable');
    expect(out.error).toContain('SETTINGS (CONNECTIONS)');
    expect(events).toHaveLength(1);
  });
  test('a witness seat is denied even with the switch on', async () => {
    ({ restore } = connectionsOn([UNREAL_CONNECTION]));
    const out = await handleUnrealTool(null, witness, null, 'default', { toolName: 'unreal_status' }, {}, { sendToolEvent: () => {} });
    expect(out.status).toBe('denied');
  });
});

describe('the calls a model makes', () => {
  test('every dialect of the name is recognised; another family\'s is not', () => {
    expect(isUnrealTool({ toolName: 'unreal_look' })).toBe(true);
    expect(isUnrealTool({ toolName: 'unreal__unreal_look' })).toBe(true);
    expect(isUnrealTool({ tool: 'unreal/unreal_python' })).toBe(true);
    expect(isUnrealTool({ toolName: 'browser_open' })).toBe(false);
    expect(isUnrealTool({})).toBe(false);
  });
  test('Fab inputs go under Epic\'s own names, and only the ones given', () => {
    expect(fabInstallArgs({ listingId: 'L', assetFormat: 'unreal-engine', engineVersion: 'UE_5.8', title: ' ' })).toEqual({ ListingId: 'L', AssetFormat: 'unreal-engine', EngineVersion: 'UE_5.8' });
    expect(fabLibraryArgs({})).toEqual({ SortBy: 'newest', Count: 24 });
    expect(fabLibraryArgs({ keywords: ' bed ', cursor: 'c1' })).toEqual({ SortBy: 'newest', Count: 24, Keywords: 'bed', Cursor: 'c1' });
  });
  test('a picture side stays inside its limits', () => {
    expect(pictureSide(undefined, 1280, 320, 2560)).toBe(1280);
    expect(pictureSide(99999, 1280, 320, 2560)).toBe(2560);
    expect(pictureSide(10, 1280, 320, 2560)).toBe(320);
    expect(pictureSide('wide', 1280, 320, 2560)).toBe(1280);
  });
});
