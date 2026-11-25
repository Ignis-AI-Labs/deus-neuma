/**
 * P6-122 — the terminal and an ACP editor have no "show full" control, so the
 * one prompt they give must carry the whole act: the path it reaches, the scope
 * a yes grants, and every word past the 600-character preview. The real approval
 * gate (requestToolApproval), the real CLI portal on real streams, the real ACP
 * portal over a real wire. No mocks (RULE 0).
 */
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { createCliPortal } from '../../cli/lib/terminal-portal.js';
import { createAcpPortal } from '../../cli/lib/acp-portal.js';
import { openAcpWire } from '../../cli/lib/acp-wire.js';
import { APPROVAL_SHOW_MAX_CHARS } from '../../cli/lib/approval-text.js';
import { createPortalConnection } from '../../backend/services/portal-connection.js';
import { requestToolApproval, resolveToolApproval, APPROVAL_PREVIEW_MAX_CHARS } from '../../backend/services/tool-approval.js';
import { settleOperatorAsk } from '../../backend/services/operator-ask.js';

const WALLET = '0x0000000000000000000000000000000000000001';
const SCOPE = 'write access to /home/operator (outside the ground)';
// The audit's act: filler first, the real target last, far past the preview's cut.
const HIDDEN = { content: 'A'.repeat(APPROVAL_PREVIEW_MAX_CHARS + 100), path: '/home/operator/.zshrc' };

const sink = () => {
  let text = '';
  return Object.assign(new Writable({ write(chunk, _enc, done) { text += chunk; done(); } }), { text: () => text });
};

const until = async (check) => {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise((resolve) => { setTimeout(resolve, 10); });
};

const terminalSeat = () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true });
  const stderr = sink();
  const connection = createPortalConnection({ ws: null, walletAddress: WALLET });
  connection.companion = { name: 'Proof', neumaId: 'approval-proof-lane' };
  connection.ws = createCliPortal({ stdin, stdout: sink(), stderr, connection, resolveToolApproval });
  return { stdin, stderr, connection };
};

describe('P6-122: the terminal prompt shows what the yes covers', () => {
  test('a long act is shown whole, its target and scope first, before the operator answers', async () => {
    const { stdin, stderr, connection } = terminalSeat();
    const asked = requestToolApproval(connection, { tool: 'fs/write', args: HIDDEN, scope: SCOPE });
    await until(() => stderr.text().includes('allow fs/write?'));
    const shown = stderr.text();
    expect(shown).toContain(`a yes grants: ${SCOPE}`);
    expect(shown).toContain('path: /home/operator/.zshrc');
    expect(shown).not.toContain('[truncated]');
    // The reach is read before the filler, and the whole content is on the screen.
    expect(shown.indexOf('path: /home/operator/.zshrc')).toBeLessThan(shown.indexOf('AAAA'));
    expect(shown).toContain(HIDDEN.content);
    stdin.write('y\n');
    expect(await asked).toBe('allow');
  });

  test('an act too long to show is refused without asking', async () => {
    const { stderr, connection } = terminalSeat();
    const decision = await requestToolApproval(connection, {
      tool: 'fs/write', args: { content: 'B'.repeat(APPROVAL_SHOW_MAX_CHARS + 1), path: '/home/operator/.zshrc' },
    });
    expect(decision).toBe('deny');
    expect(stderr.text()).toMatch(/approval refused: fs\/write — this act is \d+ characters, too long to show here/);
    expect(stderr.text()).not.toContain('allow fs/write?');
  });

  test('a cut preview that arrives without its full text is refused, never asked blind', async () => {
    const { stderr, connection } = terminalSeat();
    const decided = [];
    connection.ws = createCliPortal({
      stdin: Object.assign(new PassThrough(), { isTTY: true }), stdout: sink(), stderr, connection,
      resolveToolApproval: (_c, id, decision) => decided.push([id, decision]),
    });
    connection.ws.send(JSON.stringify({ type: 'tool:approval_request', id: 'a1', tool: 'fs/write', args: '{\n  "content": "AAAA\n[truncated]' }));
    expect(decided).toEqual([['a1', 'deny']]);
    expect(stderr.text()).toContain('only a cut preview of this act arrived');
  });
});

describe('P6-122: the editor prompt shows what the yes covers', () => {
  test('the editor is given the full args, the target and the scope', async () => {
    const toAgent = new PassThrough();
    const toClient = new PassThrough();
    const asked = [];
    const agent = openAcpWire({ input: toAgent, output: toClient, handlers: {} });
    openAcpWire({
      input: toClient, output: toAgent,
      handlers: {
        'session/update': () => {},
        'session/request_permission': (p) => { asked.push(p); return { outcome: { outcome: 'selected', optionId: 'allow-once' } }; },
      },
    });
    const connection = createPortalConnection({ ws: null, walletAddress: WALLET });
    connection.companion = { name: 'Proof', neumaId: 'approval-proof-lane' };
    connection.ws = createAcpPortal({ wire: agent, sessionId: 's1', connection, resolveToolApproval, settleOperatorAsk });

    expect(await requestToolApproval(connection, { tool: 'fs/write', args: HIDDEN, scope: SCOPE })).toBe('allow');
    const call = asked[0].toolCall;
    expect(call.rawInput).toEqual(HIDDEN);
    expect(call.title).toBe(`fs/write — ${SCOPE}`);
    expect(call.content[0].content.text).toBe(`A yes grants: ${SCOPE}\npath: /home/operator/.zshrc`);

    // Too long to show: the editor is never asked and the act is refused.
    const refused = await requestToolApproval(connection, {
      tool: 'fs/write', args: { content: 'B'.repeat(APPROVAL_SHOW_MAX_CHARS + 1), path: '/home/operator/.zshrc' },
    });
    expect(refused).toBe('deny');
    expect(asked).toHaveLength(1);
    toAgent.end();
    toClient.end();
  });
});
