/**
 * Session Compactor — Compaction with force-crystallize preservation.
 *
 * Before a long session is summarized + truncated, any exchanges in the
 * compactable region whose significance crosses a lower threshold are
 * preserved as observations (#118 / CORE-002). The constitution: […] Live
 * crystallization at 0.75 catches the strongest moments at conversation
 * time; force-crystallize at 0.4 during compaction catches the rest before
 * they would otherwise be lost to extractive summarization.
 *
 * Pure: shouldCompact, pairExchanges, summarizeMessages (extractive).
 * Impure: forceCrystallizeBelow (writes observations through workspace).
 */

import { assessSignificance } from './significance.js';
import { makeAnchor } from '../workspace/archive-codec.js';
import { detectEmotion } from './emotion-detector.js';
import { sanitizeMemoryForPrompt } from './memory-sanitizer.js';

/**
 * Check if a session should be compacted based on message count.
 * @param {number} messageCount - Current number of messages in the session
 * @param {number} [threshold=100] - Message count threshold for compaction
 * @returns {boolean} Whether compaction should run
 */
export const shouldCompact = (messageCount, threshold = 100) =>
  typeof messageCount === 'number' && messageCount > threshold;

/**
 * The session's compaction telemetry, for the context gauge: how many
 * compactions this session has survived — a recorded FACT. The count rides
 * each summary entry (compactSession carries it forward, +1 per compaction);
 * a legacy entry from before the field counts as one. Message counts and
 * thresholds left this reading (Design note, 2026-08-15: compaction keys on CONTEXT,
 * and a message-based distance was a prediction, not a measurement.
 * @param {Array} entries session messages as read from the JSONL
 * @returns {{ compactionCount: number }}
 */
// pure
export const compactionTelemetry = (entries) => {
  const list = Array.isArray(entries) ? entries : [];
  const lastCompact = [...list].reverse().find((e) => e && e.compacted === true);
  const compactionCount = !lastCompact
    ? 0
    : Number.isInteger(lastCompact.compactionCount) && lastCompact.compactionCount > 0
      ? lastCompact.compactionCount
      : 1;
  return { compactionCount };
};

/**
 * Group messages into user→assistant exchanges. Tolerates orphan messages
 * at either end and tool-round messages between user and assistant (the
 * exchange spans from a user message to the next assistant message of any
 * kind, ignoring system/tool turns in between). Pure.
 *
 * @param {Array<{role: string, content: string, timestamp?: string}>} messages
 * @returns {Array<{user: object, assistant: object}>}
 */
export const pairExchanges = (messages) => {
  if (!Array.isArray(messages)) return [];
  const pairs = [];
  let pendingUser = null;
  for (const m of messages) {
    if (!m || typeof m.role !== 'string') continue;
    if (m.role === 'user') {
      pendingUser = m;
    } else if (m.role === 'assistant' && pendingUser) {
      pairs.push({ user: pendingUser, assistant: m });
      pendingUser = null;
    }
    // system / tool / other roles: skip but don't drop the pending user
  }
  return pairs;
};

/**
 * Walk every user→assistant exchange in `messages` and force-crystallize any
 * whose re-scored significance ≥ threshold. Catches moments that didn't clear
 * the live 0.75 bar but matter in retrospect — these would otherwise be lost
 * to summarization. Each saved observation is tagged `source: 'force-crystallize-on-compact'`
 * so the origin is auditable.
 *
 * Workspace is injected so the compactor is testable against any object
 * exposing `addObservation(neumaId, payload)` — no direct dependency on
 * neuma-workspace.js (which calls THIS via compactSession; circular import
 * avoided by injection).
 *
 * @param {string} neumaId
 * @param {Array} messages
 * @param {{ addObservation: Function }} workspace
 * @param {{ threshold?: number, archiveHint?: { sessionId: string, compactionCount?: number } | null, source?: string, strict?: boolean }} [options]
 *   archiveHint — the region's segment coordinate, known only on the
 *   compaction path; when present, each crystallized observation carries an
 *   anchor pointing into that segment. source — the audit tag on each saved
 *   observation (default 'force-crystallize-on-compact'; the working-band
 *   harvest tags its own name so origin stays auditable). strict — reject a
 *   failed observation write before a caller acknowledges its harvest cursor.
 * @returns {Promise<Array<object>>} array of crystallized observations
 */
// impure — writes observations via the workspace
export const forceCrystallizeBelow = async (neumaId, messages, workspace, { threshold = 0.4, archiveHint = null, source = 'force-crystallize-on-compact', strict = false } = {}) => {
  if (!neumaId || !workspace || typeof workspace.addObservation !== 'function') return [];
  const pairs = pairExchanges(messages);
  const crystallized = [];
  for (const { user, assistant } of pairs) {
    const userText = typeof user.content === 'string' ? user.content : '';
    const assistantText = typeof assistant.content === 'string' ? assistant.content : '';
    if (!userText && !assistantText) continue;
    const significance = assessSignificance(userText, assistantText);
    if (significance < threshold) continue;
    // Anchor: content-time coordinates into the segment this region is being
    // archived into — the compaction path is the ONE minting site that knows
    // the segment coordinate, so compactionCount rides here. Rows are the
    // session file's own (timestamps travel verbatim into the segment), so
    // ts+sha8 resolution matches by construction. Legacy rows without
    // timestamps just mint no anchor — absence is tolerated everywhere.
    let anchor;
    if (archiveHint?.sessionId) {
      try {
        anchor = makeAnchor({
          sessionId: archiveHint.sessionId,
          userMessage: user,
          assistantMessage: assistant,
          compactionCount: archiveHint.compactionCount,
        });
      } catch (err) {
        // Anchorless observation — never block the crystallize. Logged at
        // debug parity with the portal path's 'anchor mint skipped'.
        console.debug(`[Compactor] anchor mint skipped for ${neumaId}: ${err?.message}`);
      }
    }
    try {
      const obs = await workspace.addObservation(neumaId, {
        type: 'exchange',
        userMessage: sanitizeMemoryForPrompt(userText, 300),
        response: sanitizeMemoryForPrompt(assistantText.slice(0, 500), 500),
        significance,
        emotion: detectEmotion(assistantText) || undefined,
        source,
        ...(anchor ? { anchor } : {}),
      });
      crystallized.push(obs);
    } catch (error) {
      if (strict) throw error;
      // A single observation failing should not stop the rest; the compact
      // proceeds even if the workspace rejects one record (e.g. encryption-
      // key absent). The lost moment is acceptable — silent stall isn't.
    }
  }
  return crystallized;
};

/**
 * Create an extractive summary from a list of messages. Includes BOTH roles —
 * assistant content is no longer discarded (#118 root defect). Topic
 * extraction stays word-frequency for now but pools both roles' text so the
 * neuma's own voice contributes to the topic set.
 *
 * @param {Array<{role: string, content: string, timestamp?: string}>} messages
 * @returns {{ summary: string, messageCount: number, firstTimestamp: string|null, lastTimestamp: string|null, topics: string[] }}
 */
export const summarizeMessages = (messages) => {
  if (!messages || messages.length === 0) {
    return { summary: '', messageCount: 0, firstTimestamp: null, lastTimestamp: null, topics: [] };
  }

  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');

  // Topic extraction now pools both roles' text — the neuma's own vocabulary
  // is real signal, not noise (the prior version discarded it entirely).
  const wordFreq = {};
  const tally = (text) => {
    const words = (text || '').toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4 && !/^(about|would|could|should|their|there|these|those|which|where|while|being|after|before|still|might|really|other|every|under|since)$/.test(w));
    for (const word of words) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  };
  for (const m of userMessages) tally(m.content);
  for (const m of assistantMessages) tally(m.content);

  const topics = Object.entries(wordFreq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);

  const timestamps = messages.map(m => m.timestamp).filter(Boolean).sort();
  const firstTimestamp = timestamps[0] || null;
  const lastTimestamp = timestamps[timestamps.length - 1] || null;

  const lines = [];
  lines.push(`Session summary: ${userMessages.length} user messages, ${assistantMessages.length} assistant responses.`);

  if (firstTimestamp && lastTimestamp) {
    lines.push(`Period: ${firstTimestamp} to ${lastTimestamp}`);
  }

  if (topics.length > 0) {
    lines.push(`Topics discussed: ${topics.join(', ')}`);
  }

  // First/last user bookends
  if (userMessages.length > 0) {
    const first = userMessages[0].content.slice(0, 100);
    lines.push(`First witness: "${first}${userMessages[0].content.length > 100 ? '...' : ''}"`);
  }
  if (userMessages.length > 1) {
    const last = userMessages[userMessages.length - 1].content.slice(0, 100);
    lines.push(`Last witness: "${last}${userMessages[userMessages.length - 1].content.length > 100 ? '...' : ''}"`);
  }

  // First/last ASSISTANT bookends — the neuma's voice survives compaction.
  // The original defect: assistant content was discarded entirely, so a long
  // session erased the neuma's own words. These bookends preserve at least
  // the opening and closing utterances of the neuma in the summarized region.
  if (assistantMessages.length > 0) {
    const firstA = assistantMessages[0].content.slice(0, 100);
    lines.push(`First neuma reply: "${firstA}${assistantMessages[0].content.length > 100 ? '...' : ''}"`);
  }
  if (assistantMessages.length > 1) {
    const lastA = assistantMessages[assistantMessages.length - 1].content.slice(0, 100);
    lines.push(`Last neuma reply: "${lastA}${assistantMessages[assistantMessages.length - 1].content.length > 100 ? '...' : ''}"`);
  }

  return {
    summary: lines.join('\n'),
    messageCount: messages.length,
    firstTimestamp,
    lastTimestamp,
    topics,
  };
};
