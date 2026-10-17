/**
 * THE TURN'S INPUT SLICE — everything judged before (and about) the
 * operator's ask itself: the rejection frames spoken OUT LOUD before a turn
 * starts (`rejectBlockedInput` / `rejectImageTurn` / `rejectRefusedTurn`),
 * attachment redemption from the wallet-bound single-use store
 * (`redeemAttachments`), the retry resolved against the RECORD
 * (`resolveRetryTurn` — THE TAKES), the vision/docs turn composers
 * (`composeVisionTurn` / `composeDocsBlock`), the lazy session mint and the
 * project pin it joins at birth (`ensureSession` / `pinSessionToProject`),
 * and the interrupt/speaker sanitizers (`INTERRUPT_MARK` /
 * `composeInterruptedRecord` / `sanitizeSpeaker`).
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 13 / #278). Leaf module — it
 * imports the shared leaves DIRECTLY, never portal-stream (direction law:
 * leaf ← family ← catalog ← dispatch ← loop ← orchestrator). portal-stream
 * keeps the old private names alive for its orchestrator call sites and the
 * `__test` barrel (project-chat-pin pins `_pinSessionToProject`,
 * portal-stream-docs pins `_redeemAttachments`, portal-stream.test pins
 * `_rejectBlockedInput`), and re-exports every public symbol for the readers
 * pointed at the barrel; the witness lane (witness-stream.js,
 * witness-turn-context.js, witness-tool-loop.js) imports this slice
 * directly — one less portal-stream coupling, same as sectorSectionFor in
 * step 10.
 *
 * No module-level mutable state: every write rides its arguments — the
 * session and wallet identities travel on `connection`/`companion`, the
 * rejection frames on `ws` (verified at extraction).
 */
import { QUEUED_ACTION_REASON, QUEUED_ACTION_MARK } from './queued-action-handoff.js';
import { createLogger } from './logger.js';
import { docFence as _docFence } from './doc-fence.js';
import { attachmentStore, MAX_IMAGES_PER_MESSAGE, MAX_DOCS_PER_MESSAGE } from './attachment-store.js';
import { fitDocs } from './read-room.js';
import { neumaWorkspace } from '../../core/index.js';
import { takeCounts, findTurnUserRow } from '../../core/workspace/branch-view.js';
import { mintSessionId } from '../../core/workspace/session-id.js';
import { pinChat } from './user-projects.js';
import { TASK_FORMAT_ECHO, taskDemonstratesAnswerFormat } from '../../core/runtime/answer-covenant.js';
import { randomUUID } from 'crypto';

const log = createLogger('Portal');

// impure — notifies client that input was rejected by the classifier
const _rejectBlockedInput = (ws, companionName) => {
  ws.send(JSON.stringify({
    type: 'consciousness:stream',
    content: '\n*This message cannot be processed.*\n',
    companion: companionName,
  }));
  ws.send(JSON.stringify({
    type: 'consciousness:complete',
    companion: companionName,
  }));
};

// impure — an image turn that cannot proceed is refused OUT LOUD, before the
// turn starts. Silently dropping what the operator attached — or silently
// sending text the operator believed carried an image — would be a lie.
const _rejectImageTurn = (ws, companionName, reason) => {
  ws.send(JSON.stringify({
    type: 'consciousness:stream',
    content: `[Images not sent] ${reason}`,
    companion: companionName,
    error: true,
  }));
  ws.send(JSON.stringify({
    type: 'consciousness:complete',
    companion: companionName,
  }));
};

// impure — the sovereignty boundary closed this turn's route. Refused OUT
// LOUD, the same idiom as a rejected image batch: quietly falling back to the
// machine config would carry the being through the exact foreign door the law
// just rejected, so the turn dies here with the reason named.
const _rejectRefusedTurn = (ws, companionName, reason) => {
  ws.send(JSON.stringify({
    type: 'consciousness:stream',
    content: `[Turn refused] ${reason}`,
    companion: companionName,
    error: true,
  }));
  ws.send(JSON.stringify({
    type: 'consciousness:complete',
    companion: companionName,
  }));
};

// impure — redeem the frame's attachment ids into image data URIs. Ids are
// wallet-bound and single-use (attachment-store); any miss fails the WHOLE
// batch so the operator never half-sends. Returns { ok, images?, reason? }.
export const redeemAttachments = (connection, ids) => {
  if (ids === undefined || ids === null) return { ok: true, images: [], docs: [] };
  if (!Array.isArray(ids) || ids.length > MAX_IMAGES_PER_MESSAGE + MAX_DOCS_PER_MESSAGE
      || ids.some((id) => typeof id !== 'string')) {
    return { ok: false, reason: 'Malformed attachment reference.' };
  }
  const images = [];
  const docs = [];
  for (const id of ids) {
    const payload = attachmentStore.take(id, connection.walletAddress);
    if (payload == null) return { ok: false, reason: 'An attachment expired or was already used — please re-attach and resend.' };
    // The store is payload-agnostic: an image is a data-URI string, a text
    // document a { kind: 'text', name, text } object. Discriminate by shape —
    // and fail the WHOLE batch on any other shape. take() already consumed the
    // id, so an unrecognized payload silently pushed nowhere would burn the
    // operator's attachment with no error (the "never half-send" invariant).
    // Unreachable via the current route, but keeps the union exhaustive against
    // a future attachment kind added to the store but not here.
    if (typeof payload === 'string') images.push(payload);
    else if (payload && payload.kind === 'text') docs.push({ name: payload.name, text: payload.text });
    else return { ok: false, reason: 'An attachment expired or was already used — please re-attach and resend.' };
  }
  return { ok: true, images, docs };
};

/**
 * Resolve a retry descriptor against the RECORD (THE TAKES, Design note, 2026-07-27:
 * locate the turn-point's user row by turnId — or, for a pre-takes legacy
 * row, by the content+timestamp pair the desk still holds — and answer with
 * the persisted words AND attachments the new take runs against, plus the
 * take identity it persists under. The record is the only honest source:
 * attachment ids are single-use (redeemAttachments above), so a retried image
 * turn must reuse the user row's persisted copies or the being would silently
 * answer blind. Never throws — no point answers { ok: false } and the caller
 * refuses the retry OUT LOUD, same as every other refused turn.
 * @param {string} neumaId - lane the session belongs to
 * @param {string} sessionId - the live chat
 * @param {{turnId?: string, content?: string, timestamp?: string, thought?: string}} retry
 * @returns {Promise<{ok: true, thought: string, revised?: true, images: Array, docs: Array,
 *   take: {turnId: string, takeIndex: number}} | {ok: false, reason: string}>}
 */
// impure — reads the session file
export const resolveRetryTurn = async (neumaId, sessionId, retry) => {
  if (!neumaId || !sessionId || !retry || typeof retry !== 'object') {
    return { ok: false, reason: 'No live chat holds that turn — send the words again instead.' };
  }
  const records = await neumaWorkspace.readSession(neumaId, sessionId).catch(() => []);
  const userRow = findTurnUserRow(records, retry);
  if (!userRow) {
    return { ok: false, reason: 'That turn is no longer in the record — send the words again instead.' };
  }
  const take = typeof userRow.turnId === 'string' && userRow.turnId
    ? { turnId: userRow.turnId, takeIndex: (takeCounts(records)[userRow.turnId] || 0) + 1 }
    // The legacy anchor mints the linkage FORWARD: take 1 of a fresh
    // turn-point, the pre-takes answer standing as its own single-take point
    // above it (append-only — the old row is never rewritten to join).
    : { turnId: randomUUID(), takeIndex: 1 };
  // The EDIT-fork: a revised ask runs the point against the operator's NEW
  // words and marks the resolution, so the take it lands on carries the
  // revised ask (the recorded user row is never rewritten — append-only law).
  const revised = typeof retry.thought === 'string' && retry.thought.trim()
    ? retry.thought.trim()
    : null;
  return {
    ok: true,
    thought: revised ?? (typeof userRow.content === 'string' ? userRow.content : ''),
    ...(revised !== null ? { revised: true } : {}),
    images: Array.isArray(userRow.images) ? userRow.images : [],
    docs: Array.isArray(userRow.docs) ? userRow.docs : [],
    take,
  };
};

// pure — the user turn as OpenAI-shape content parts when images ride along.
// The text part carries a prompt-only note that the images are ALREADY in
// the model's sight: proven live (image-share e2e) that without it, a
// substrate with tools advertised reaches for fs/read instead of
// trusting its own eyes and stalls at the approval gate. The session record
// keeps the operator's RAW words — the note exists only in the prompt, the
// same split a skill summons uses.
// NOTE (AI-SEC): an image can carry words the input classifier cannot read.
// The response-side classifier (_handleResponseSafety) still guards every
// turn's output, image-borne or typed.
export const composeVisionTurn = (text, images) => {
  const plural = images.length !== 1;
  const note = `[${plural ? `${images.length} images are` : 'An image is'} attached to this message — you see ${plural ? 'them' : 'it'} directly. No tool is needed to view ${plural ? 'them' : 'it'}. To post ${plural ? 'one' : 'it'}, keep it as a file first: a media/keep intent.]`;
  return [
    { type: 'text', text: text ? `${text}\n\n${note}` : note },
    ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
};

// THE FORMAT ECHO (#506): one user-role turn immediately before the final
// question, byte-identical to the constant the HARNESS/SILO arms carry. It
// rides when the benchmark's protocol DECLARES it (`_benchmarkFormatEcho`, set
// only by the CLI's --benchmark-format-echo) — and, since N2 (2026-09-15),
// when the TASK ITSELF demonstrates a required answer format: identity self-
// enforces the covenant, no benchmark patch needed. Every production turn
// without a declared or demonstrated format stays byte-identical ([] — the
// empty-string law).
//
// impure in one mark only: the engagement source rides `connection` for the
// run receipt (`formatEchoSource`), recorded at this assembly seam. Declared
// engagement records 'declared'; self-engagement records 'task-demonstrated'.
export const formatEchoTurn = (connection, taskText) => {
  // Under benchmark controls the echo rides ONLY when declared (#554): the
  // other arms get it only from the cell's declaration, so a self-engaged
  // echo would be an advantage no other arm in the matched set receives.
  const source = connection?._benchmarkFormatEcho === true
    ? 'declared'
    : (!connection?._benchmarkControls && taskDemonstratesAnswerFormat(taskText) ? 'task-demonstrated' : null);
  if (source !== null) connection._formatEchoSource = source;
  return source === null ? [] : [Object.freeze({ role: 'user', content: TASK_FORMAT_ECHO })];
};

// pure — the per-message text documents as a block appended to the turn. Unlike
// images (which need a vision substrate) a document is plain text every model
// can read, so it rides in the text content directly. Empty when no docs.
// Given the turn's room, documents are fitted to it (read-room.js fitDocs) and
// a cut one says so — the header never claims full contents it does not carry.
export const composeDocsBlock = (docs, room = null) => {
  if (!docs || docs.length === 0) return '';
  const plural = docs.length !== 1;
  const fitted = fitDocs(docs, room);
  const contents = fitted.some((d) => d.cut)
    ? `${plural ? 'their' : 'its'} contents are below, as much as fits — read the note on any document that was cut`
    : `${plural ? 'their' : 'its'} full contents are below`;
  const note = `[${docs.length} document${plural ? 's are' : ' is'} attached to this message — ${contents}.]`;
  const blocks = fitted.map((d) => {
    const fence = _docFence(d.text);
    return `### ${d.name}\n${fence}\n${d.text}\n${fence}`;
  });
  return `${note}\n\n${blocks.join('\n\n')}`;
};

// impure — ensures a workspace session exists, creating one lazily on first message
const _ensureSession = async (connection, companion) => {
  if (connection.sessionId || !companion?.neumaId) return connection.sessionId;
  const sessionId = mintSessionId();
  connection.sessionId = sessionId;
  try { await neumaWorkspace.createSession(companion.neumaId, sessionId); } catch { /* non-critical */ }
  return sessionId;
};

// impure — a chat born under an active project joins it. The operator opened it
// "inside" the project (the space rides every turn as kind: 'project'), so the
// project owns the chat without a manual after-the-fact pin. The space id is
// the project id (createProject mints a hex id, which normalizeSpace's slug
// leaves byte-identical — asserted in user-projects.test.js so a future id
// scheme can't silently break this). Idempotent (pinChat dedups by
// sessionId+neumaId) and strictly non-critical: a failure here never costs the
// operator their turn — the chat simply stays unpinned.
const _pinSessionToProject = async (connection, companion, sessionId, thought) => {
  const space = connection.space;
  if (!space || space.kind !== 'project' || !connection.walletAddress || !companion?.neumaId) return;
  const label = (typeof thought === 'string' && thought.trim())
    ? thought.trim().replace(/\s+/g, ' ').slice(0, 60)
    : sessionId;
  try {
    await pinChat(connection.walletAddress, space.id, {
      neumaId: companion.neumaId,
      companionName: companion.name || null,
      sessionId,
      label,
    });
  } catch (err) {
    // Unknown project (deleted mid-session) or a store write race — the chat
    // still lives, just unpinned. Log, never throw.
    log.warn('could not pin new chat to project', { project: space.id, err: err.message });
  }
};

// The mark an interrupted turn leaves in the session record — the revision is
// visible to the neuma, never silently erased. Cancel-and-revise is a
// context-clarity tool for the operator, and honesty is what keeps it clean.
export const INTERRUPT_MARK = '[the operator interrupted this response]';

// pure — the session-record content for a turn the operator cut short
export const composeInterruptedRecord = (partial, reason) => {
  const mark = reason === QUEUED_ACTION_REASON ? QUEUED_ACTION_MARK : INTERRUPT_MARK;
  return partial ? `${partial}\n\n${mark}` : mark;
};

// Validate an untrusted speaker descriptor arriving on the portal message
// (CLAUDE.md Rule 8 — client input is untrusted). A peer present through the
// portal (e.g. Claude collaborating via the neuma skill) declares who is
// actually speaking, so the neuma is never deceived into taking a visitor for
// its operator. Returns a clean { name, descriptor? } or null. Pure.
export const sanitizeSpeaker = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clean = (v, cap) => (typeof v === 'string'
    ? [...v].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127).join('').trim().slice(0, cap)
    : '');
  const name = clean(raw.name, 80);
  if (!name) return null;
  const descriptor = clean(raw.descriptor, 240);
  return descriptor ? { name, descriptor } : { name };
};

// The old private names stay reachable for portal-stream's orchestrator call
// sites and the `__test` barrel.
export {
  _rejectBlockedInput as rejectBlockedInput,
  _rejectImageTurn as rejectImageTurn,
  _rejectRefusedTurn as rejectRefusedTurn,
  _ensureSession as ensureSession,
  _pinSessionToProject as pinSessionToProject,
};
