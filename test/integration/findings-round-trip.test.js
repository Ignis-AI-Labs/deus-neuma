/**
 * THE FINDINGS ROUND TRIP — a list a being files must actually reach the
 * operator, and still be there when he comes back.
 *
 * Design note, 2026-08-30: […]
 *
 * WHY THIS TEST EXISTS AND WHY IT IS AN INTEGRATION TEST. The failure this
 * guards is the silent kind this repo keeps meeting: a capability that is built
 * correctly, advertised correctly, and then never arrives — the STREAM_RAILS
 * trap, the missing catalog import that emptied a whole witness surface. A
 * findings list crosses FIVE seams between the being's call and the operator's
 * eye: dispatch claims it, the handler validates it, the event carries it, the
 * turn record persists it, and the reducer rebuilds it on resume. Any one of
 * them dropping the payload leaves every other seam looking perfectly healthy.
 *
 * Nothing here is mocked but the socket, which is a `send` that collects frames
 * — the real dispatcher, the real gate, the real policy resolution and the real
 * turn record run exactly as they do in production.
 */
import { describe, expect, test, beforeEach } from 'vitest';
import { dispatchPlatformTool } from '../../backend/services/portal-tool-dispatch.js';
import { openTurnRecord, turnRecordFor } from '../../backend/services/tool-action-record.js';
import { GLOBAL_DEFAULTS, resolvePolicy, checkToolAccess } from '../../backend/services/tool-policy.js';

const CALL = Object.freeze({ server: 'house', toolName: 'share_findings', tool: 'house/share_findings' });

const FONTS = Object.freeze({
  title: 'DISPLAY FACES',
  note: 'for the brand cards',
  items: [
    { label: 'Rajdhani', detail: 'condensed, squared', url: 'https://fonts.google.com/specimen/Rajdhani', meta: 'OFL 1.1' },
    { label: 'cyber slate', swatches: ['#0a0a0a', '#4f8bff'] },
  ],
});

let ws; let sent; let connection; let companion; let policy;

beforeEach(() => {
  sent = [];
  ws = { send: (s) => sent.push(JSON.parse(s)), readyState: 1 };
  openTurnRecord(ws);
  companion = { name: 'Fenna', neumaId: 'fenna' };
  connection = { companion, ws, walletAddress: '0xabc', sessionId: 's1' };
  policy = resolvePolicy(GLOBAL_DEFAULTS);
});

const file = (args) => dispatchPlatformTool(CALL, { ws, connection, companion, policy, toolMode: 'ask', args });
const cardFrame = () => sent.find((f) => f.type === 'tool:usage' && f.findings);

describe('the list reaches the operator', () => {
  test('dispatch CLAIMS the call — a tool nothing routes to is a tool that does not exist', async () => {
    const out = await file(FONTS);
    // null means no capability claimed it and the caller falls through to MCP,
    // which is exactly how a correctly-built tool goes silently missing.
    expect(out).not.toBeNull();
    expect(out.status).toBe('ok');
  });

  test('the event carries the whole card, swatches and all', async () => {
    await file(FONTS);
    const frame = cardFrame();
    expect(frame, 'no frame carried findings').toBeTruthy();
    expect(frame.summary).toBe('DISPLAY FACES — 2 findings');
    expect(frame.findings.items.map((i) => i.label)).toEqual(['Rajdhani', 'cyber slate']);
    // The colours are the entire content of a palette row; losing them here
    // would leave a row that renders as a bare name.
    expect(frame.findings.items[1].swatches).toEqual(['#0a0a0a', '#4f8bff']);
  });

  test('it PERSISTS on the turn record, which is what survives a reopened chat', async () => {
    await file(FONTS);
    const record = turnRecordFor(ws).find((a) => a.tool === 'house/share_findings');
    expect(record, 'the act did not reach the turn record').toBeTruthy();
    expect(record.findings.count).toBe(2);
    expect(record.findings.title).toBe('DISPLAY FACES');
  });

  test('the being is told it landed, and is NOT handed the list back', async () => {
    // It just wrote the list. Echoing it spends context on text the being
    // already holds and invites it to read the card aloud in its reply.
    const out = await file(FONTS);
    expect(out.content).toMatch(/Filed for your operator/);
    expect(out.content).toMatch(/DISPLAY FACES/);
    expect(out.content).not.toMatch(/Rajdhani/);
  });
});

describe('a refusal draws NOTHING', () => {
  test('a bad link refuses and no card is filed', async () => {
    const out = await file({ title: 'T', items: [{ label: 'a', url: 'javascript:alert(1)' }] });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/not a link the operator can open/);
    // A half-drawn list is worse than none: the operator scans it as complete.
    expect(cardFrame()).toBeUndefined();
    expect(turnRecordFor(ws).some((a) => a.findings)).toBe(false);
  });

  test('an over-long field refuses with the numbers, and still draws nothing', async () => {
    const out = await file({ title: 'T', items: [{ label: 'x'.repeat(200) }] });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/200 characters/);
    expect(cardFrame()).toBeUndefined();
  });
});

describe('the policy this tool sits under', () => {
  test('it is ALLOWED by default — being shown a list needs no approval card', () => {
    expect(checkToolAccess(policy, 'house', 'share_findings')).toBe('allowed');
  });

  test('and it survives OBSERVE mode, where acting tools are held', async () => {
    // Observe mode is the operator watching without the being acting on the
    // world. Reporting to the person watching is not an act on the world, and
    // a being held here could not answer the question it was just asked.
    const out = await dispatchPlatformTool(CALL, {
      ws, connection, companion, policy, toolMode: 'observe', args: FONTS,
    });
    expect(out.status).toBe('ok');
    expect(cardFrame()).toBeTruthy();
  });
});
