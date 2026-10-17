/**
 * The thought bubble's frame must be sent by a sender that EXISTS.
 *
 * Shipped defect, caught 2026-07-30 by an eslint `no-undef` sweep over the
 * committed blob: the neuma seat's `onReasoning` called `safeSend(...)` — the
 * WITNESS seat's name for its sender. In portal-stream that identifier is
 * undefined, so the first time a neuma emitted reasoning the handler threw a
 * ReferenceError instead of sending the frame.
 *
 * It survived a live proof because that proof drove the consume path with its
 * own callback and never went through `streamConsciousness`, so the portal
 * frame was never exercised on the neuma seat at all.
 *
 * This is a SOURCE assertion, and deliberately so: `onReasoning` is a closure
 * inside a turn, unreachable without driving a whole live turn, and the defect
 * is a name that does not resolve — which is a property of the text, not of any
 * runtime state. The real general guard for this class is an eslint `no-undef`
 * pass over backend/**; eslint is not currently a devDependency, so this pins
 * the specific regression until that gate exists.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFile(path.join(root, rel), 'utf8');

/** The body of `const onReasoning = (…) => { … }` in a module's source. */
const onReasoningBody = (source) => {
  const start = source.indexOf('const onReasoning');
  expect(start, 'onReasoning must exist — the thinking channel depends on it').toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('};', start) + 2);
};

describe('the neuma seat sends its thinking frame with its OWN sender', () => {
  // The neuma seat's onReasoning moved with the LLM run slice to
  // portal-llm-run.js (size-law breakdown step 11) — the law follows the code.
  test('the neuma seat onReasoning calls _safeSend, never the witness seat name', async () => {
    const source = await read('backend/services/portal-llm-run.js');
    const body = onReasoningBody(source);
    expect(body).toContain('consciousness:thinking');
    expect(body).toMatch(/\b_safeSend\(/);
    // The exact regression: the bare name is not defined in this module.
    expect(body).not.toMatch(/(?<!_)\bsafeSend\(/);
  });

  test('neither neuma-seat module calls a bare safeSend anywhere — no such binding exists there', async () => {
    for (const rel of ['backend/services/portal-stream.js', 'backend/services/portal-llm-run.js']) {
      const source = await read(rel);
      const bare = [...source.matchAll(/(?<![\w_])safeSend\(/g)];
      expect(bare, `${rel} uses _safeSend; a bare safeSend would throw`).toHaveLength(0);
    }
  });

  test('the witness seat keeps its own sender, which IS defined there', async () => {
    const source = await read('backend/services/witness-stream.js');
    const body = onReasoningBody(source);
    expect(body).toContain('consciousness:thinking');
    expect(body).toMatch(/\bsafeSend\(/);
    expect(source).toMatch(/(?:const|function)\s+safeSend|import\s*\{[^}]*\bsafeSend\b/);
  });
});
