// Pure subject-only refinement corpus grammar.

import {
  REFINEMENT_CORPUS_SYSTEM_INSTRUCTION,
  REFINEMENT_CORPUS_USER_INSTRUCTION,
} from './corpus-manifest.js';

export const DEFAULT_MILESTONE = Object.freeze({ minSamples: 100, minDays: 30 });
const STATIC_SYSTEM_INSTRUCTION = REFINEMENT_CORPUS_SYSTEM_INSTRUCTION;
const STATIC_USER_INSTRUCTION = REFINEMENT_CORPUS_USER_INSTRUCTION;
export const MAX_RENDERED_CORPUS_BYTES = 64 * 1024 * 1024;
export const MAX_RENDERED_CORPUS_SAMPLES = 10_000;
export const MAX_RENDERED_MESSAGE_BYTES = 1024 * 1024;

const bytes = (value) => Buffer.byteLength(value, 'utf8');
const canonicalInstant = (value) => typeof value === 'string'
  && new Date(value).toISOString() === value;

/**
 * One authenticated subject completion becomes one context-free sample.
 * Original user, operator, system, tool, recall, vault, and cross-being bytes
 * never enter this function. Pure.
 */
export const sampleFromSubjectCompletion = ({ content, occurredAt } = {}) => {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('subject completion content must be a non-empty string');
  }
  if (bytes(content) > MAX_RENDERED_MESSAGE_BYTES) {
    throw new Error('subject completion exceeds its message byte ceiling');
  }
  if (!canonicalInstant(occurredAt)) {
    throw new Error('subject completion occurredAt must be a canonical instant');
  }
  return Object.freeze({
    messages: Object.freeze([
      Object.freeze({ role: 'system', content: STATIC_SYSTEM_INSTRUCTION }),
      Object.freeze({ role: 'user', content: STATIC_USER_INSTRUCTION }),
      Object.freeze({ role: 'assistant', content }),
    ]),
    occurredAt,
  });
};

/** Build a bounded sample array only from already-authenticated completions. Pure. */
export const corpusSamples = ({ completions } = {}) => {
  if (!Array.isArray(completions) || completions.length > MAX_RENDERED_CORPUS_SAMPLES) {
    throw new Error(`completions must be an array of at most ${MAX_RENDERED_CORPUS_SAMPLES}`);
  }
  return Object.freeze({
    system: STATIC_SYSTEM_INSTRUCTION,
    samples: Object.freeze(completions.map(sampleFromSubjectCompletion)),
  });
};

/** Milestone math over eligible subject outputs only. Pure. */
export function milestoneStatus(samples, thresholds = {}, since = null) {
  const minSamples = Number.isInteger(thresholds.minSamples) && thresholds.minSamples > 0
    ? thresholds.minSamples : DEFAULT_MILESTONE.minSamples;
  const minDays = Number.isInteger(thresholds.minDays) && thresholds.minDays > 0
    ? thresholds.minDays : DEFAULT_MILESTONE.minDays;
  const cutoff = typeof since === 'string' && !Number.isNaN(Date.parse(since)) ? since : null;
  const counted = (samples || []).filter((sample) =>
    !cutoff || (typeof sample?.occurredAt === 'string' && sample.occurredAt > cutoff));
  const days = new Set(counted
    .map((sample) => sample.occurredAt?.slice(0, 10))
    .filter(Boolean));
  return Object.freeze({
    sampleCount: counted.length,
    distinctDays: days.size,
    minSamples,
    minDays,
    ready: counted.length >= minSamples && days.size >= minDays,
    ...(cutoff && { since: cutoff }),
  });
}

/**
 * Render a bounded exact JSONL projection. The fixed generic messages are
 * asserted rather than trusted, preventing a stored prompt/context from being
 * smuggled back into training through a malformed sample.
 */
export function renderJsonl(samples) {
  if (!Array.isArray(samples) || samples.length > MAX_RENDERED_CORPUS_SAMPLES) {
    throw new Error(`samples must be an array of at most ${MAX_RENDERED_CORPUS_SAMPLES}`);
  }
  const chunks = [];
  let total = 0;
  for (const [index, sample] of samples.entries()) {
    const messages = sample?.messages;
    if (!Array.isArray(messages) || messages.length !== 3
      || messages[0]?.role !== 'system'
      || messages[0]?.content !== STATIC_SYSTEM_INSTRUCTION
      || messages[1]?.role !== 'user'
      || messages[1]?.content !== STATIC_USER_INSTRUCTION
      || messages[2]?.role !== 'assistant'
      || typeof messages[2]?.content !== 'string') {
      throw new Error(`sample ${index} is not a subject-only corpus sample`);
    }
    if (bytes(messages[2].content) > MAX_RENDERED_MESSAGE_BYTES) {
      throw new Error(`sample ${index} exceeds its message byte ceiling`);
    }
    const line = `${JSON.stringify({ messages })}\n`;
    const lineBytes = bytes(line);
    if (total > MAX_RENDERED_CORPUS_BYTES - lineBytes) {
      throw new Error('rendered corpus exceeds its byte ceiling');
    }
    total += lineBytes;
    chunks.push(line);
  }
  return chunks.join('');
}
