/**
 * WHAT A RENDER IS, in the words a person reads (Design note, 2026-10-23: […]).
 *
 * One filed type, `image/generate`, renders stills AND videos. The wire name
 * stays: saved intents, the operator's standing grants on
 * `intents/image.generate` and beings' habits all ride it. What a person (or a
 * being) READS is decided here, by the pipeline's own `kind` in the registry:
 * a video pipeline reads video everywhere, every other kind (still, portrait,
 * form) reads image. Pure — no IO, no clock.
 */
import { resolvePipeline } from './pack-registry.js';

/**
 * @param {{kind?: string}|null|undefined} pipeline a registry pipeline
 * @returns {'video'|'image'}
 */
export const renderKindOf = (pipeline) => (pipeline?.kind === 'video' ? 'video' : 'image');

/**
 * The kind a filing asks for, read from its `pipeline` field. An unknown or
 * absent pipeline is the default still — the same pipeline validate resolves.
 * @param {{pipeline?: string}|null|undefined} fields the filed intent's fields
 * @returns {'video'|'image'}
 */
export const renderKindOfFiling = (fields) => {
  const resolved = resolvePipeline(fields?.pipeline);
  return resolved.ok ? renderKindOf(resolved.pipeline) : 'image';
};

/** The act's name on a chip or a card: `video/generate` or `image/generate`. */
export const renderActName = (kind) => `${kind === 'video' ? 'video' : 'image'}/generate`;

/** What holds the machine while it renders, as the machine line names it. */
export const renderLeaseLabel = (kind, pipelineLabel) => `${kind === 'video' ? 'Video' : 'Image'} Forge — ${pipelineLabel}`;

/** […], […]. */
export const renderingLine = (kind, what) => `rendering ${kind === 'video' ? 'video' : 'image'} — ${what}`;

/**
 * Bytes as a person reads them: "969 KB", "4.2 MB".
 * @param {number} bytes
 * @returns {string}
 */
export const readableSize = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const counted = (n, kind) => `${n} ${kind === 'video' ? 'video' : 'image'}${n === 1 ? '' : 's'}`;

// pure — the render's shape from the values it was built with: a clip's length
// and orientation, a still's canvas. Unknown parts are left out, never guessed.
const shapeOf = (kind, values) => {
  const w = Number(values?.width);
  const h = Number(values?.height);
  const sized = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  if (kind !== 'video') return sized ? [`${w}×${h}`] : [];
  const seconds = Number(values?.seconds);
  return [
    ...(Number.isFinite(seconds) && seconds > 0 ? [`${seconds} s`] : []),
    ...(sized ? [w < h ? 'portrait' : w > h ? 'landscape' : 'square'] : []),
  ];
};

/**
 * The finished chip's line: […].
 * @param {'video'|'image'} kind
 * @param {Array<{bytes: number}>} stored the collected outputs, first is the one shown
 * @param {object} values the values the graph was built with
 * @returns {string}
 */
export const madeLine = (kind, stored, values) => {
  const parts = [readableSize(stored[0]?.bytes), ...shapeOf(kind, values)].filter(Boolean);
  return `made ${counted(stored.length, kind)}${parts.length ? ` — ${parts.join(' · ')}` : ''}`;
};

/** The forge activity row's tally: […]. */
export const madeTally = (kind, count, values) =>
  [counted(count, kind), ...shapeOf(kind, values), `seed ${values?.seed}`].join(' · ');

/** One stored render as the being reads it in its receipt. */
export const madeReceiptLine = (kind, record, values) =>
  `- ${kind === 'video' ? 'video' : 'image'} id: ${record.imageId} (${[record.mime, readableSize(record.bytes), ...shapeOf(kind, values)].filter(Boolean).join(', ')})`;

/**
 * The card's scope line — the one line the operator's yes stands on.
 * @param {'video'|'image'} kind
 * @param {{prompt?: string, pipeline?: string, image?: string}} fields
 * @returns {string}
 */
export const renderScope = (kind, fields) => {
  const prompt = String(fields?.prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const pipeline = fields?.pipeline ? ` (${fields.pipeline})` : '';
  if (kind !== 'video') return `render an image: "${prompt}"${pipeline}`;
  const from = typeof fields?.image === 'string' && fields.image ? ` from image ${fields.image}` : '';
  return `render a video${from}: "${prompt}"${pipeline}`;
};

/**
 * The desk notice when a render reaches its end, naming what it was.
 * @param {{phase: string, kind?: string, beingName?: string}} record a forge activity record
 * @returns {string}
 */
export const renderNoticeTitle = (record) => {
  const who = record?.beingName || 'A being';
  const what = record?.kind === 'video' ? 'a video' : 'an image';
  if (record?.phase === 'error') return `${who} could not finish ${what}`;
  if (record?.phase === 'stopped') return `${who} stopped ${what}`;
  return `${who} finished ${what}`;
};
