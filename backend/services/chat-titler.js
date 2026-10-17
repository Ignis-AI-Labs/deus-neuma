/**
 * Chat titler — names the witness's chats from what was actually said.
 *
 * A chat's default label is its timestamp; the witness navigates by topic.
 * This service reads a session's speech (never its tool payloads), asks the
 * conduit for a short title, and writes it into the witness's own label
 * overlay (`user-chat-labels.js`) — sovereign session data is only ever read,
 * never modified. Batch runs are sequential and failure-isolated: one bad
 * chat never costs the names already earned.
 *
 * Pure helpers (buildTranscript, cleanTitle) carry no IO; the LLM call and
 * the label writes are isolated and marked impure.
 */

import { createLogger } from './logger.js';
import { createStreamRequest, consumeStream } from './llm-provider.js';
import { getChatLabels, setChatLabel } from './user-chat-labels.js';
import { getCouncilLabels, setCouncilLabel } from './user-council-labels.js';
import { readCouncilRecord, listCouncilRecords } from './council-store.js';
import { neumaWorkspace } from '../../core/index.js';
import { stripToolBlocks } from '../../core/runtime/tool-stream-suppressor.js';
import { isWitnessLaneId } from './witness-lane.js';
import { resolveWitnessRoute } from './witness-route-resolver.js';
import { resolveNeumaRoute } from './neuma-route-resolver.js';
import { withLineKind } from './substrate-lease.js';

const log = createLogger('ChatTitler');

const HEAD_MESSAGES = 6;       // opening turns — what the chat began about
const TAIL_MESSAGES = 6;       // closing turns — where the drift landed
const PER_MESSAGE_CAP = 500;   // chars per turn in the naming transcript
const TOTAL_CAP = 6000;        // chars for the whole transcript
const TITLE_MAX_LENGTH = 80;   // a title longer than this is a bad title
const TITLE_TEMPERATURE = 0.3;
const TITLE_MAX_TOKENS = 400;  // think-block headroom (cf. heartbeat consolidation)

const TITLE_PROMPT = [
  'You name chats. Given a transcript, write a 2-7 word title naming what the',
  'conversation is about as a whole; if the topic drifts, name the through-line',
  'or the latest dominant topic. Output ONLY the title — no quotes, no prefix,',
  'no trailing period.',
].join(' ');

const COUNCIL_TITLE_PROMPT = [
  'You name councils. Given a transcript of a council sitting with named',
  'members, write a 2-7 word title naming what the council deliberated or',
  'decided — the question on the floor, not the attendance list. Output ONLY',
  'the title — no quotes, no prefix, no trailing period.',
].join(' ');

// A council sitting is the room's record, not a one-on-one chat — the same
// guard the Chats window applies (frontend/app/RelinkShell/session-history.js).
const isCouncilSession = (sessionId) => String(sessionId).startsWith('council-');

/**
 * Session records → a bounded naming transcript: speech only (tool blocks
 * stripped from neuma turns), head+tail sampling so both the chat's origin
 * and its drift are visible, per-turn and total caps. '' when the chat has
 * no speech worth naming.
 * @param {Array<Object>} messages - raw session records
 * @returns {string}
 */
export const buildTranscript = (messages) => {
  const speech = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role,
      content: (m.role === 'assistant' ? stripToolBlocks(m.content) : String(m.content ?? '')).trim(),
    }))
    .filter((m) => m.content.length > 0);
  if (speech.length === 0) return '';
  const sampled = speech.length <= HEAD_MESSAGES + TAIL_MESSAGES
    ? speech
    : [...speech.slice(0, HEAD_MESSAGES), ...speech.slice(-TAIL_MESSAGES)];
  return sampled
    .map((m) => `${m.role === 'user' ? 'WITNESS' : 'NEUMA'}: ${m.content.slice(0, PER_MESSAGE_CAP)}`)
    .join('\n')
    .slice(0, TOTAL_CAP);
};

/**
 * Raw model output → a usable title: first non-empty line, any "Title:"
 * preamble dropped, surrounding quotes and terminal punctuation stripped,
 * whitespace collapsed, length capped. '' when nothing usable remains.
 * @param {string} raw
 * @returns {string}
 */
export const cleanTitle = (raw) => {
  if (!raw || typeof raw !== 'string') return '';
  const firstLine = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || '';
  const cleaned = firstLine
    .replace(/^title\s*:\s*/i, '')
    .replace(/^["'`«»*\s.!]+|["'`«»*\s.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Code-point slice — a UTF-16 .slice can split a surrogate pair at the
  // boundary and persist a lone surrogate into the witness's label (the same
  // guard toLabel carries in workspace-routes.js).
  return Array.from(cleaned).slice(0, TITLE_MAX_LENGTH).join('').trim();
};

/**
 * The conduit a lane's words may be named through — each lane's OWN route:
 * a witness lane rides its sealed provider, a neuma lane the sovereign route
 * its turns ride, and the house's council record (no lane of its own) the
 * sovereign machine route. Null means there is no honest conduit — an
 * unconfigured witness route, or the sovereignty boundary refusing the
 * machine default — and the caller skips titling rather than borrowing a
 * conduit the words do not belong to. Impure.
 * @param {string|null} laneId - witness lane id, neuma id, or null (council)
 */
const titlingRouteFor = async (laneId) => {
  try {
    if (laneId && isWitnessLaneId(laneId)) {
      const route = await resolveWitnessRoute(laneId);
      if (route.configured) return route;
      log.warn('witness route unconfigured — titling skipped', { laneId, reason: route.reason });
      return null;
    }
    return await resolveNeumaRoute(laneId ?? null, null);
  } catch (err) {
    log.warn('titling route unavailable — titling skipped', { laneId, error: err.message });
    return null;
  }
};

// impure — one bounded conduit call: transcript in, cleaned title out ('' on
// an empty answer). Same one-shot shape as the heartbeat's summarizer. The
// route is the lane's OWN (titlingRouteFor) — never a borrowed machine
// config, so a witness's words never cross into the local substrate nor a
// neuma's into a foreign door.
const summarizeTitle = async (transcript, systemPrompt = TITLE_PROMPT, route = null) => {
  // Background work: a title waits behind every chat and team member for the house's server.
  return withLineKind('background', async () => {
    const streamResult = await createStreamRequest(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
      { temperature: TITLE_TEMPERATURE, maxTokens: TITLE_MAX_TOKENS, ...(route ? { route } : {}) },
    );
    return cleanTitle(await consumeStream(streamResult, () => {}));
  });
};

// impure — name one chat; failures are reported, never thrown into the batch.
const titleOneSession = async (neumaId, wallet, sessionId, route) => {
  try {
    const transcript = buildTranscript(await neumaWorkspace.readSession(neumaId, sessionId));
    if (!transcript) return { sessionId, status: 'skipped' }; // no speech to name
    const label = await summarizeTitle(transcript, TITLE_PROMPT, route);
    if (!label) return { sessionId, status: 'failed' };
    await setChatLabel(wallet, neumaId, sessionId, label);
    return { sessionId, status: 'titled', label };
  } catch (error) {
    log.warn('Auto-title failed for chat', { neumaId, sessionId, error: error.message });
    return { sessionId, status: 'failed' };
  }
};

/**
 * Name one or more of a neuma's chats for this witness. Candidates: the
 * explicit `sessionIds` when given, else every one-on-one session in the
 * workspace (council sittings excluded). Without `force`, chats that already
 * carry a custom label are left alone — a batch never clobbers names the
 * witness kept. Each chat is persisted as it lands, so an interrupt keeps
 * the progress made.
 * @param {Object} args
 * @param {string} args.wallet - authenticated witness wallet
 * @param {string} args.neumaId - workspace owner of the chats
 * @param {string[]} [args.sessionIds] - explicit chats to name (batch when omitted)
 * @param {boolean} [args.force=false] - retitle even already-labeled chats
 * @returns {Promise<{results: Array<{sessionId: string, status: 'titled'|'skipped'|'failed', label?: string, reason?: string}>, labels: Object}>}
 */
// impure
export const autotitleSessions = async ({ wallet, neumaId, sessionIds = null, force = false }) => {
  const candidates = sessionIds
    ? [...sessionIds]
    : (await neumaWorkspace.listSessions(neumaId)).filter((id) => !isCouncilSession(id));
  const named = force ? {} : await getChatLabels(wallet);
  const pending = candidates.filter((id) => force || !named[`${neumaId}:${id}`]);
  // The lane's OWN route or nothing: an unresolvable/unconfigured route
  // skips the batch honestly — a witness's words never borrow the machine
  // config, and a neuma's never ride a door the boundary refused.
  const route = await titlingRouteFor(neumaId);
  if (!route) {
    return {
      results: pending.map((sessionId) => ({ sessionId, status: 'skipped', reason: 'no-route' })),
      labels: await getChatLabels(wallet),
    };
  }
  const results = [];
  for (const sessionId of pending) {
    results.push(await titleOneSession(neumaId, wallet, sessionId, route));
  }
  return { results, labels: await getChatLabels(wallet) };
};

/**
 * A council's record → a bounded naming transcript: the roster line first
 * (who sat is part of what the sitting was), then delivered utterances only —
 * `undelivered` words never reached the floor (CQ-029) and do not speak here.
 * Speaker prefix from the utterance's display name. Same head+tail sampling
 * and caps as chat transcripts. '' when the floor heard no speech.
 * @param {{meta: Object, turns: Array<Object>}} record
 * @returns {string}
 */
export const buildCouncilTranscript = ({ meta, turns } = {}) => {
  const speech = (Array.isArray(turns) ? turns : [])
    .filter((t) => t && !t.undelivered)
    .map((t) => ({ speaker: String(t.name || t.speaker || 'MEMBER').toUpperCase(), content: String(t.content ?? '').trim() }))
    .filter((t) => t.content.length > 0);
  if (speech.length === 0) return '';
  const roster = (Array.isArray(meta?.members) ? meta.members : [])
    .map((m) => m?.name || m?.neumaId)
    .filter(Boolean)
    .join(', ');
  const sampled = speech.length <= HEAD_MESSAGES + TAIL_MESSAGES
    ? speech
    : [...speech.slice(0, HEAD_MESSAGES), ...speech.slice(-TAIL_MESSAGES)];
  return [roster ? `MEMBERS PRESENT: ${roster}` : null]
    .concat(sampled.map((t) => `${t.speaker}: ${t.content.slice(0, PER_MESSAGE_CAP)}`))
    .filter(Boolean)
    .join('\n')
    .slice(0, TOTAL_CAP);
};

// impure — name one council; failures are reported, never thrown into the batch.
const titleOneCouncil = async (wallet, councilId, route) => {
  try {
    const record = await readCouncilRecord(wallet, councilId);
    const transcript = record ? buildCouncilTranscript(record) : '';
    if (!transcript) return { councilId, status: 'skipped' }; // no delivered speech to name
    const label = await summarizeTitle(transcript, COUNCIL_TITLE_PROMPT, route);
    if (!label) return { councilId, status: 'failed' };
    await setCouncilLabel(wallet, councilId, label);
    return { councilId, status: 'titled', label };
  } catch (error) {
    log.warn('Auto-title failed for council', { councilId, error: error.message });
    return { councilId, status: 'failed' };
  }
};

/**
 * Name one or more of the witness's councils from what was deliberated.
 * Candidates: the explicit `councilIds` when given, else every council on the
 * shelf. Without `force`, councils that already carry a custom label are left
 * alone. Each council is persisted as it lands.
 * @param {Object} args
 * @param {string} args.wallet - authenticated witness wallet
 * @param {string[]} [args.councilIds] - explicit councils to name (batch when omitted)
 * @param {boolean} [args.force=false] - retitle even already-labeled councils
 * @returns {Promise<{results: Array<{councilId: string, status: 'titled'|'skipped'|'failed', label?: string, reason?: string}>, labels: Object}>}
 */
// impure
export const autotitleCouncils = async ({ wallet, councilIds = null, force = false }) => {
  const candidates = councilIds
    ? [...councilIds]
    : (await listCouncilRecords(wallet)).map((c) => c.councilId);
  const named = force ? {} : await getCouncilLabels(wallet);
  const pending = candidates.filter((id) => force || !named[id]);
  // A council belongs to no single lane — the house's record is named through
  // the house's sovereign route (titlingRouteFor(null)); if the boundary
  // refuses it, the batch skips honestly rather than riding a foreign door.
  const route = await titlingRouteFor(null);
  if (!route) {
    return {
      results: pending.map((councilId) => ({ councilId, status: 'skipped', reason: 'no-route' })),
      labels: await getCouncilLabels(wallet),
    };
  }
  const results = [];
  for (const councilId of pending) {
    results.push(await titleOneCouncil(wallet, councilId, route));
  }
  return { results, labels: await getCouncilLabels(wallet) };
};
