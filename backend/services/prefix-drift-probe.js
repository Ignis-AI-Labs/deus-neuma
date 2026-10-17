/**
 * THE PREFIX-DRIFT PROBE — where does a local request stop matching the last
 * one? llama-server reuses a slot's cache only up to the first differing
 * token, and this model family's template renders the TOOL LIST first, then
 * the system prompt, then the conversation. A drift near the top re-reads the
 * whole chat: live 2026-09-25, turn starts re-processed ~95k tokens (~41 s)
 * after the clock had already been moved out of the system prompt.
 *
 * Every local request is fingerprinted in render order — template kwargs,
 * each tool, the system message, each message — and compared with the most
 * similar of the last few requests. The FIRST differing unit is recorded:
 * what kind it is, its position, a tool's NAME, a message's role, and how
 * many characters precede it. Counts and names only — no prompt text, no
 * message content, ever. Lines land in `<data>/logs/prefix-drift.jsonl`,
 * capped by rotation. Never blocks, never throws into the request.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataRoot } from './data-root.js';

const RECENT = 4;
const FILE_MAX_BYTES = 2 * 1024 * 1024;
const recent = [];

const digest = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value ?? null)).digest('hex').slice(0, 16);

/**
 * Pure — a request body as its render-order units.
 * @param {Object} body the chat-completions body
 * @returns {Array<{kind: string, label: string, hash: string, chars: number}>}
 */
export const prefixUnits = (body) => {
  const units = [{ kind: 'kwargs', label: 'chat_template_kwargs', hash: digest(body?.chat_template_kwargs), chars: 0 }];
  for (const tool of body?.tools || []) {
    const text = JSON.stringify(tool);
    units.push({ kind: 'tool', label: String(tool?.function?.name || '?'), hash: digest(text), chars: text.length });
  }
  (body?.messages || []).forEach((message, i) => {
    const text = JSON.stringify(message?.content ?? '');
    units.push({ kind: message?.role === 'system' && i === 0 ? 'system' : 'message', label: `${i}:${message?.role}`, hash: digest(text), chars: text.length });
  });
  return units;
};

/**
 * Pure — the first unit where `next` departs from `prev`, and what it cost.
 * @returns {{shared: number, of: number, sharedChars: number, totalChars: number, at: Object|null}}
 */
export const prefixDrift = (prev, next) => {
  let shared = 0;
  while (shared < prev.length && shared < next.length && prev[shared].hash === next[shared].hash) shared += 1;
  const sharedChars = next.slice(0, shared).reduce((sum, u) => sum + u.chars, 0);
  const totalChars = next.reduce((sum, u) => sum + u.chars, 0);
  const at = shared < next.length ? { kind: next[shared].kind, label: next[shared].label } : null;
  const prevAt = shared < prev.length ? { kind: prev[shared].kind, label: prev[shared].label } : null;
  return { shared, of: next.length, sharedChars, totalChars, at, prevAt };
};

// impure — append one line, rotating the file past its cap.
const appendLine = async (line) => {
  const file = path.join(getDataRoot(), 'logs', 'prefix-drift.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const size = await fs.stat(file).then((s) => s.size, () => 0);
  if (size > FILE_MAX_BYTES) await fs.rename(file, `${file}.prev`).catch(() => {});
  await fs.appendFile(file, `${line}\n`, { mode: 0o600 });
};

/**
 * impure — fingerprint this local request, record its drift against the most
 * similar recent request, remember it. Fire-and-forget.
 * @param {Object} body
 */
export const recordPrefixDrift = (body) => {
  try {
    const units = prefixUnits(body);
    const best = recent
      .map((prev) => prefixDrift(prev, units))
      .sort((a, b) => b.sharedChars - a.sharedChars)[0] || null;
    recent.unshift(units);
    recent.length = Math.min(recent.length, RECENT);
    appendLine(JSON.stringify({
      at: new Date().toISOString(),
      tools: (body?.tools || []).length,
      messages: (body?.messages || []).length,
      ...(best ? { drift: best } : { drift: 'first request' }),
    })).catch(() => {});
  } catch { /* observability never breaks a turn */ }
};
