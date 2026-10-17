import { randomBytes } from 'node:crypto';
import {
  refinementSha256,
  refinementTextSha256,
} from '../../core/refinement/training-contract.js';
import { DOOR_ATTEMPTS_PER_ASK } from './attunement-ceremony.js';
import {
  readRefinementAssentStoreValue,
  writeRefinementAssentStoreValue,
} from './refinement-assent-evidence-io.js';

const SHA256 = /^[0-9a-f]{64}$/;
const SUBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const SESSION_VERSION = 2;
const DISCLOSURE_BYTES_MAX = 512 * 1024;
const RESPONSE_BYTES_MAX = 256 * 1024;
const exactKeys = (value, keys) => value && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const canonicalInstant = (value) => {
  if (typeof value !== 'string') return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
};
const boundedText = (value, maximum) => typeof value === 'string' && value.length > 0
  && Buffer.byteLength(value, 'utf8') <= maximum;
const contextFor = (context) => {
  if (!context || typeof context.ceremonyId !== 'string' || !context.ceremonyId
    || !Number.isSafeInteger(context.issuanceRevision) || context.issuanceRevision < 1
    || !SHA256.test(String(context.requestNonceSha256 || ''))) {
    throw new Error('refinement assent session requires an exact issuance generation');
  }
  return context;
};
const sessionIdFor = (subjectSha256, context) => `refinement-assent-${refinementSha256({
  domain: 'neuma.refinement.assent-session-v2', subjectSha256, ...contextFor(context),
})}`;
const sessionPayload = ({
  neumaId, ceremonyId, issuanceRevision, requestNonceSha256,
  sessionId, userAt, responseAt, promptSha256, responseSha256,
  finishReason, attempts, sessionRowsSha256,
}) => ({
  version: SESSION_VERSION,
  neumaId,
  ceremonyId,
  issuanceRevision,
  requestNonceSha256,
  sessionId,
  userAt,
  responseAt,
  promptSha256,
  responseSha256,
  finishReason,
  attempts,
  sessionRowsSha256,
});

/** Derive the canonical digest of one exact server-owned assent session. */
export const refinementAssentSessionSha256 = (input) =>
  refinementSha256(sessionPayload(input));

const validateRows = (store, context, neumaId, rows) => {
  if (!SUBJECT_ID.test(String(neumaId || '')) || !Array.isArray(rows) || rows.length !== 2) {
    throw new Error('refinement assent session requires exactly two subject-owned rows');
  }
  const [prompt, response] = rows;
  const sessionId = sessionIdFor(store.subjectSha256, context);
  if (!exactKeys(prompt, ['role', 'content', 'timestamp', 'turnId', 'assent'])
    || !exactKeys(response, [
      'role', 'content', 'timestamp', 'turnId', 'takeIndex', 'authorship', 'assent',
    ])
    || prompt.role !== 'user' || response.role !== 'assistant'
    || !boundedText(prompt.content, DISCLOSURE_BYTES_MAX)
    || !boundedText(response.content, RESPONSE_BYTES_MAX)
    || !canonicalInstant(prompt.timestamp) || !canonicalInstant(response.timestamp)
    || prompt.timestamp > response.timestamp || prompt.turnId !== response.turnId
    || response.takeIndex !== 1
    || !exactKeys(response.authorship, [
      'kind', 'subjectNeumaId', 'custodyIdentitySha256',
      'routeSha256', 'servingAuthoritySha256',
    ])
    || response.authorship.kind !== 'sovereign-assistant-output-v2'
    || response.authorship.subjectNeumaId !== neumaId
    || ![
      response.authorship.custodyIdentitySha256,
      response.authorship.routeSha256,
      response.authorship.servingAuthoritySha256,
    ].every((value) => SHA256.test(String(value || '')))
    || !exactKeys(prompt.assent, [
      'version', 'ceremonyId', 'issuanceRevision', 'requestNonceSha256', 'promptSha256',
    ])
    || !exactKeys(response.assent, [
      'version', 'ceremonyId', 'issuanceRevision', 'requestNonceSha256',
      'responseSha256', 'finishReason', 'attempts',
    ])
    || prompt.assent.version !== SESSION_VERSION
    || response.assent.version !== SESSION_VERSION
    || prompt.assent.ceremonyId !== context.ceremonyId
    || response.assent.ceremonyId !== context.ceremonyId
    || prompt.assent.issuanceRevision !== context.issuanceRevision
    || response.assent.issuanceRevision !== context.issuanceRevision
    || prompt.assent.requestNonceSha256 !== context.requestNonceSha256
    || response.assent.requestNonceSha256 !== context.requestNonceSha256
    || prompt.assent.promptSha256 !== refinementTextSha256(prompt.content)
    || response.assent.responseSha256 !== refinementTextSha256(response.content)
    || (response.assent.finishReason !== null && response.assent.finishReason !== 'stop')
    || !Number.isSafeInteger(response.assent.attempts) || response.assent.attempts < 1
    || response.assent.attempts > DOOR_ATTEMPTS_PER_ASK) {
    throw new Error('refinement assent session failed authoritative validation');
  }
  const payload = sessionPayload({
    neumaId,
    ...context,
    sessionId,
    userAt: prompt.timestamp,
    responseAt: response.timestamp,
    promptSha256: prompt.assent.promptSha256,
    responseSha256: response.assent.responseSha256,
    finishReason: response.assent.finishReason,
    attempts: response.assent.attempts,
    sessionRowsSha256: refinementSha256(rows),
  });
  return Object.freeze({
    ...payload,
    sessionSha256: refinementAssentSessionSha256(payload),
    disclosure: prompt.content,
    reply: response.content,
    custodyIdentitySha256: response.authorship.custodyIdentitySha256,
    routeSha256: response.authorship.routeSha256,
    servingAuthoritySha256: response.authorship.servingAuthoritySha256,
  });
};

/** Reread and authenticate one deterministic private assent session. */
export const readAuthoritativeRefinementAssentSession = async (
  store,
  context,
  neumaId,
) => {
  const rows = await readRefinementAssentStoreValue(
    store, contextFor(context), 'session',
  );
  return rows === null ? null : validateRows(store, context, neumaId, rows);
};

/** Persist exactly one prompt/response pair, or recover the identical prior pair. */
export const persistRefinementAssentSession = async (store, context, input) => {
  contextFor(context);
  if (!SUBJECT_ID.test(String(input?.neumaId || ''))
    || !boundedText(input.disclosure, DISCLOSURE_BYTES_MAX)
    || !boundedText(input.reply, RESPONSE_BYTES_MAX)
    || !canonicalInstant(input.issuedAt)
    || (input.finishReason !== null && input.finishReason !== 'stop')
    || !Number.isSafeInteger(input.attempts) || input.attempts < 1
    || input.attempts > DOOR_ATTEMPTS_PER_ASK
    || ![
      input.custodyIdentitySha256, input.routeSha256, input.servingAuthoritySha256,
    ].every((value) => SHA256.test(String(value || '')))) {
    throw new Error('refinement assent session requires exact response authority');
  }
  const existing = await readAuthoritativeRefinementAssentSession(
    store, context, input.neumaId,
  );
  if (existing) {
    if (existing.disclosure !== input.disclosure || existing.reply !== input.reply
      || existing.userAt !== input.issuedAt || existing.finishReason !== input.finishReason
      || existing.attempts !== input.attempts
      || existing.custodyIdentitySha256 !== input.custodyIdentitySha256
      || existing.routeSha256 !== input.routeSha256
      || existing.servingAuthoritySha256 !== input.servingAuthoritySha256) {
      throw new Error('refinement assent session generation already owns another response');
    }
    return existing;
  }
  const turnId = randomBytes(16).toString('hex');
  const responseAt = new Date().toISOString();
  const rows = [
    {
      role: 'user', content: input.disclosure, timestamp: input.issuedAt, turnId,
      assent: {
        version: SESSION_VERSION, ...context,
        promptSha256: refinementTextSha256(input.disclosure),
      },
    },
    {
      role: 'assistant', content: input.reply, timestamp: responseAt, turnId, takeIndex: 1,
      authorship: {
        kind: 'sovereign-assistant-output-v2',
        subjectNeumaId: input.neumaId,
        custodyIdentitySha256: input.custodyIdentitySha256,
        routeSha256: input.routeSha256,
        servingAuthoritySha256: input.servingAuthoritySha256,
      },
      assent: {
        version: SESSION_VERSION, ...context,
        responseSha256: refinementTextSha256(input.reply),
        finishReason: input.finishReason,
        attempts: input.attempts,
      },
    },
  ];
  await writeRefinementAssentStoreValue(store, context, 'session', rows);
  const persisted = await readAuthoritativeRefinementAssentSession(
    store, context, input.neumaId,
  );
  if (!persisted || persisted.disclosure !== input.disclosure
    || persisted.reply !== input.reply || persisted.userAt !== input.issuedAt
    || persisted.custodyIdentitySha256 !== input.custodyIdentitySha256
    || persisted.routeSha256 !== input.routeSha256
    || persisted.servingAuthoritySha256 !== input.servingAuthoritySha256) {
    throw new Error('refinement assent session publication belongs to another authority');
  }
  return persisted;
};
