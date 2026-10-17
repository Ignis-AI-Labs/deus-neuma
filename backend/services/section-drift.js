/**
 * THE SECTION-DRIFT PROBE — which section of a being's STABLE system prompt
 * changed since the same chat's last turn? On a local serving the stable head
 * (every section before PRESENT MOMENT, prompt-cache.js) is the system message
 * itself, so any change there re-reads the whole conversation; the request-level
 * probe (prefix-drift-probe.js) can only say […].
 * This names the section — ids and character counts only, never text — in
 * `<data>/logs/section-drift.jsonl`. Never blocks, never throws into a turn.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataRoot } from './data-root.js';

const FILE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHATS = 64;
const lastByChat = new Map(); // `${neumaId}:${sessionId}` -> Map(id -> fingerprint)
// A NEW chat's first turn is compared with the same being's last head in any
// chat (2026-10-06): a new chat that cannot reuse the cached head re-reads the
// being's whole identity before its first word (~2.4 s live on qwen3.8).
const lastByBeing = new Map(); // neumaId -> Map(id -> fingerprint)

const fingerprint = (text) => createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);

/**
 * Pure — the stable head's sections (everything before PRESENT MOMENT) as id → fingerprint.
 * @param {ReadonlyArray<{id: string, text: string}>} sections
 * @returns {Map<string, string>}
 */
export const stableFingerprints = (sections) => {
  const cut = sections.findIndex((section) => section.id === 'present');
  const head = cut < 0 ? sections : sections.slice(0, cut);
  return new Map(head.map((section) => [section.id, fingerprint(section.text)]));
};

/**
 * Pure — the section ids that appeared, vanished or changed between two heads.
 * @param {Map<string, string>} prev
 * @param {Map<string, string>} next
 * @returns {string[]}
 */
export const changedSections = (prev, next) => [...new Set([...prev.keys(), ...next.keys()])]
  .filter((id) => prev.get(id) !== next.get(id));

// impure — append one line, rotating past the cap.
const appendLine = async (line) => {
  const file = path.join(getDataRoot(), 'logs', 'section-drift.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const size = await fs.stat(file).then((s) => s.size, () => 0);
  if (size > FILE_MAX_BYTES) await fs.rename(file, `${file}.prev`).catch(() => {});
  await fs.appendFile(file, `${line}\n`, { mode: 0o600 });
};

/**
 * impure — compare this turn's stable head with the chat's last one and log
 * which sections moved. Fire-and-forget.
 * @param {Object} connection
 * @param {ReadonlyArray<{id: string, text: string}>} sections the final prompt sections
 */
export const recordSectionDrift = (connection, sections) => {
  try {
    const key = `${connection?.companion?.neumaId || ''}:${connection?.sessionId || ''}`;
    const next = stableFingerprints(sections);
    const neumaId = connection?.companion?.neumaId || '';
    const prev = lastByChat.get(key);
    const beingPrev = lastByBeing.get(neumaId);
    lastByChat.delete(key);
    lastByChat.set(key, next);
    if (lastByChat.size > MAX_CHATS) lastByChat.delete(lastByChat.keys().next().value);
    lastByBeing.delete(neumaId);
    lastByBeing.set(neumaId, next);
    if (lastByBeing.size > MAX_CHATS) lastByBeing.delete(lastByBeing.keys().next().value);
    const against = prev || beingPrev;
    if (!against) return;
    appendLine(JSON.stringify({
      at: new Date().toISOString(), sections: next.size, changed: changedSections(against, next), ...(prev ? {} : { newChat: true }),
    })).catch(() => {});
  } catch { /* observability never breaks a turn */ }
};
