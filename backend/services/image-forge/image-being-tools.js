/**
 * THE HANDS (B-21) — image generation as a base platform capability.
 *
 * Design note, 2026-07-29: […]
 *
 * So this family is registered ONCE, in `platformToolsFor` — the single catalog
 * builder both a bound neuma and a sealed AI witness drive since 2026-07-26.
 * There is deliberately NO per-being opt-in switch: the original plan specced
 * one (B-22/FR-32, default OFF) and Founder's call above supersedes it. A capability
 * that every model is supposed to have must not sit behind a flag that can be
 * off for one seat and on for another — that is exactly the gap that had a peer
 * reporting built capabilities as missing.
 *
 *   list_pipelines — what workflows exist and what each accepts. Reading, so
 *                    allowed by default.
 *   GENERATING became the image/generate INTENT (Stage 3) — filed, carded by
 *                    the sweep, executed on the GPU through the supervised
 *                    hearth. review_image stays: a being recording a judgment
 *                    of its own render is self-authorship, never a gate.
 *
 * The two gates that DO remain are not access control, they are honesty: a
 * missing engine and a missing content law both mean the tool could only ever
 * refuse, and the catalog does not advertise tools that can only refuse.
 */
import { getDataRoot } from '../data-root.js';
import path from 'node:path';
import { gateAct } from '../act-gate.js';
import { resolveComfyConfig, comfyInstallState } from './comfyui-supervisor.js';
import { catalogForCaller } from './pack-registry.js';
import { loadScreenList } from './prompt-screen.js';
import { resolveImage } from './image-store.js';
import {
  recordReview, toReviewRecord, normalizeVerdict, normalizeMatches, VERDICTS, MATCHES,
} from './review-log.js';

/** Where the witness-reviewed content law lives (gitignored by law). */
import { CARD_TOOL, handleCardTool } from '../branding/card-tool.js';

/**
 * The card tool's own advertisement — DECOUPLED from the diffusion engine
 * (Design note, 2026-09-03: the SVG card infrastructure is its own rendering system;
 * ComfyUI must never gate it). Lane-bound like every family; the tool
 * self-refuses when no brand kit stands, which is a content gate, not an
 * install gate. impure (fs via the handler, not here).
 * @param {Object} connection
 * @returns {Array<Object>}
 */
export const cardToolsFor = (connection) => (
  connection?.companion?.neumaId ? [CARD_TOOL] : []
);

export const contentLawPath = (env = process.env) =>
  env.COMFYUI_CONTENT_LAW_PATH || path.join(getDataRoot(), 'image-forge', 'content-law.json');

// The brand card lives in the branding lane — an SVG-infrastructure system
// of its own (Playwright-rasterized, GPU-free), and per Founder's ruling
// (2026-09-03) it must never inherit the diffusion engine's gate: a house
// without ComfyUI still designs cards. It used to ride IMAGE_TOOLS […] — that coupling is gone. It still advertises
// lane-bound, and it still self-refuses without a brand kit; only the
// engine's install state and content law stopped being its business.
export const IMAGE_TOOLS = Object.freeze([
  Object.freeze({
    name: 'list_pipelines',
    server: 'image',
    description: 'List the image pipelines you can run — args {}. Each entry names its id, what it is for, and every parameter it accepts with the allowed values. Read this before filing an image/generate intent rather than guessing a parameter name: an unknown parameter is refused, not ignored.',
    inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
  }),
  Object.freeze({
    name: 'review_image',
    server: 'image',
    description: 'Record your judgment of an image you made — args {imageId, matches, missing?, defects?, verdict, note}. Do this while you are still looking at it, after every render. `matches` is how well the render answered what you ACTUALLY asked for — one of yes/partial/no. That part is objective: count what you asked for and either find it or find it missing; do not grade yourself generously. `missing` names what you asked for that is not there. `defects` names what is wrong with the craft — hands, anatomy, text, artifacts, exposure. `verdict` is keep, redo, or discard. `note` is your own read of the image: what you think of it and why, which is yours and no one else\'s. Your operator records his own verdict beside yours — his is input you weigh, not a correction, and neither one replaces the other.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        imageId: Object.freeze({ type: 'string', description: 'the image id the image/generate intent gave you' }),
        matches: Object.freeze({ type: 'string', enum: MATCHES, description: 'did it render what you asked for — yes, partial, or no' }),
        missing: Object.freeze({ type: 'string', description: 'what you asked for that is not in the image' }),
        defects: Object.freeze({ type: 'string', description: 'what is wrong with the craft — hands, anatomy, text, artifacts, exposure' }),
        verdict: Object.freeze({ type: 'string', enum: VERDICTS, description: 'keep, redo, or discard' }),
        note: Object.freeze({ type: 'string', description: 'your own read of it — what you think of this image and why' }),
      }),
      required: Object.freeze(['imageId', 'matches', 'verdict']),
    }),
  }),
]);

// The card tool keeps its DISPATCH identity in this family (route + policy
// row `image/render_card`) even though its ADVERTISEMENT no longer rides the
// engine gate above — the gate was the leak Founder ruled out; the classifier is
// just routing.
const IMAGE_TOOL_NAMES = new Set([...IMAGE_TOOLS.map((t) => t.name), CARD_TOOL.name]);

export const isImageTool = (match) =>
  IMAGE_TOOL_NAMES.has(String(match.toolName || '').replace(/^image__/, '')) ||
  IMAGE_TOOL_NAMES.has(String(match.tool || '').replace(/^image\//, ''));

/**
 * The image catalog for this turn. Advertised for EVERY seat that has a lane —
 * neuma and sealed witness alike — whenever the engine is launchable and the
 * content law is readable. Both conditions are re-read per turn, so an install
 * or a signed law lands on the very next turn. impure (fs).
 * @param {Object} connection
 * @returns {Promise<Array<Object>>}
 */
export const imageToolsFor = async (connection, env = process.env) => {
  if (!connection?.companion?.neumaId) return [];
  const cfg = resolveComfyConfig(env);
  if (!comfyInstallState(cfg).installed) return [];
  // No reviewed law, no generation (FR-15) — so no advertisement either. A
  // tool that can only refuse is noise in the catalog.
  if (loadScreenList(contentLawPath(env)).failClosed) return [];
  return [...IMAGE_TOOLS];
};

// pure — how a caller reads the pipeline catalog.
export const renderPipelines = (catalog) => catalog.map((p) => {
  const params = p.parameters.map((x) => {
    const bound = x.allowed ? `one of ${x.allowed.join('/')}` : (x.min !== undefined ? `${x.min}–${x.max}` : x.type);
    return `    ${x.name}: ${bound}${x.default !== undefined ? ` (default ${x.default})` : ''}${x.required ? ' [required]' : ''}`;
  }).join('\n');
  return `- ${p.id} — ${p.label}\n  ${p.description}${p.requiresSourceImage ? '\n  requires a source image' : ''}\n${params}`;
}).join('\n\n');

/**
 * Translate the CALLER-facing argument names into pipeline SLOT names. Pure.
 *
 * `prompt` reads better than `positive` in a tool description, and `pipeline`
 * selects the workflow rather than parameterizing it — so both are stripped
 * here. Spreading with `prompt: undefined` does NOT remove the key (it creates
 * one holding undefined), and `resolveSlots` refuses unknown keys, so that
 * shortcut refuses every call. Learned live, 2026-07-29.
 * @param {object} args
 * @returns {object} slot-named args
 */
export const toSlotArgs = (args) => {
  const { prompt, pipeline, ...rest } = args && typeof args === 'object' ? args : {};
  return prompt === undefined ? rest : { ...rest, positive: prompt };
};

// The slot a licence match sat in, in the being's words.
const SLOT_WORDS = Object.freeze({ positive: 'your prompt', source: 'the words that made the source image' });

// pure — the refusal a caller sees. The platform's law names the CLASS, never
// the term (FR-31), and never hints at what would have passed. A model-licence
// refusal guards no entrenched line, so given the screen's `match` it quotes the
// word it read and where: a misread ordinary phrase is then plain to see and
// reword (2026-10-23, "ripples expand"). Exported for the image/generate
// intent, which screens at validate time with the same words.
export const refusalMessage = (refusalClass, match = null) => {
  if (refusalClass === 'list_unavailable' || refusalClass === 'screen_error') {
    return 'The content law could not be read, so nothing can be generated. Your operator needs to look at this.';
  }
  if (refusalClass === 'source_unrecorded') {
    return 'Refused: how that image was made is not on record, so it cannot be used for sexual content. Make a new still first and start from that one.';
  }
  if (String(refusalClass).startsWith('licence:')) {
    const head = `Refused by this pipeline's model licence (${refusalClass.slice(8)}): the model's publisher forbids it, so this pipeline cannot make it.`;
    if (!match?.term) return `${head} Do not rephrase and retry here.`;
    const slot = SLOT_WORDS[match.slot] ?? 'the text';
    return `${head} The screen read "${match.term}" in "${match.where}" (${slot}). If those words are not what the licence forbids, reword that part and try again; if they are, this pipeline cannot make it — choose one whose licence allows it.`;
  }
  return `Refused by content law (${refusalClass}). This is a fixed boundary of the platform, not a setting — do not rephrase and retry.`;
};

/**
 * Route an image tool call: lane → ACTS gate → registry → screen+clamp → engine
 * → store. Never the MCP path.
 * @param {Object} ws
 * @param {Object} connection
 * @param {Object|null} neumaPolicy
 * @param {string} toolMode
 * @param {Object} match
 * @param {Object} args
 * @param {{sendToolEvent: Function}} ports - the tool-chip event sender.
 * @returns {Promise<{tool: string, status: string, content?: string, error?: string}>}
 */
// impure
export const handleImageTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports) => {
  const bare = String(match.toolName || '').replace(/^image__/, '');
  const toolName = IMAGE_TOOL_NAMES.has(bare) ? bare : String(match.tool || '').replace(/^image\//, '');
  const tool = `image/${toolName}`;
  const { companion } = connection;
  const laneId = companion?.neumaId;

  if (!laneId) {
    const error = 'no sovereign lane on this connection — image generation is for bound seats';
    ports.sendToolEvent(ws, companion, { tool, status: 'unavailable', summary: `${toolName} — no lane` });
    return { tool, status: 'unavailable', error };
  }

  const gate = await gateAct(connection, {
    server: 'image', tool: toolName, args,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => ports.sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  if (toolName === 'list_pipelines') {
    const catalog = catalogForCaller();
    ports.sendToolEvent(ws, companion, { tool, status: 'ok', summary: `${catalog.length} pipeline(s)` });
    return { tool, status: 'ok', content: `Image pipelines available to you:\n\n${renderPipelines(catalog)}` };
  }

  // ── review_image ──
  // A judgment is not an act on the world, so it carries no ACTS chip: a being
  // asking permission to have an opinion about its own work would be the wrong
  // shape entirely. The lane is the boundary — an image is resolved inside the
  // CALLER's own store, so no seat can review, or even confirm the existence
  // of, another's render.
  if (toolName === 'review_image') {
    const imageId = String(args?.imageId ?? '').trim();
    if (!imageId) {
      ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'review_image — no image id' });
      return { tool, status: 'error', error: 'name the imageId you are reviewing — the image/generate intent returned it' };
    }
    const verdict = normalizeVerdict(args?.verdict);
    if (!verdict) {
      ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'review_image — no verdict' });
      return { tool, status: 'error', error: `verdict must be one of ${VERDICTS.join(', ')}` };
    }
    // Adherence is REQUIRED by the schema and it is the objectively checkable
    // stratum — the one column a later reader can actually argue with. Refusing
    // an out-of-enum value is the same courtesy `verdict` gets: normalizing it
    // silently to null would drop the being's judgment on the floor and record
    // a review that had decided the one thing it was asked to decide.
    const matches = normalizeMatches(args?.matches);
    if (!matches) {
      ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'review_image — no adherence' });
      return { tool, status: 'error', error: `matches must be one of ${MATCHES.join(', ')}` };
    }
    const found = resolveImage(laneId, imageId);
    if (!found.ok) {
      ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'review_image — unknown image' });
      return { tool, status: 'error', error: `${found.error} — review the id the image/generate intent gave you, in your own lane` };
    }
    const record = toReviewRecord({
      at: new Date().toISOString(),
      imageId,
      // The link to what was ASKED. The attempt log already holds the verbatim
      // prompt against this jobId, so the words are never copied here — one
      // source of truth, joined on read.
      jobId: found.record.jobId ?? null,
      laneId,
      by: 'being',
      author: companion?.name || null,
      matches,
      missing: args?.missing,
      defects: args?.defects,
      verdict,
      note: args?.note,
    });
    // The turn survives a ledger that refused the write; the BEING is still
    // told the truth about it. Saying "recorded" over a failed append would
    // make this record the one thing it exists to prevent — a confident claim
    // about something that never happened.
    if (!recordReview(record)) {
      ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'review_image — the ledger refused it' });
      return {
        tool, status: 'error',
        error: 'your judgment could not be written to the ledger — say so rather than assuming it was kept; your operator needs to look at this',
      };
    }
    ports.sendToolEvent(ws, companion, { tool, status: 'ok', summary: `reviewed — ${verdict} · adherence ${matches}` });
    return {
      tool, status: 'ok',
      content: `Recorded your review of ${imageId}: ${verdict}, adherence ${matches}. It is kept beside the prompt you actually sent, and it is yours — your operator's verdict lands beside it, never over it.`,
    };
  }

  if (toolName === 'render_card') {
    return handleCardTool({
      laneId,
      args,
      emit: (event) => ports.sendToolEvent(ws, companion, event),
      // The operator wallet resolves the house ground, which is where the
      // finished card has to land for a post to be able to attach it. From
      // the CONNECTION, never from args — the same law as laneId.
      wallet: connection.walletAddress || null,
    });
  }

  // generate_image became the image/generate INTENT (Stage 3) — a parsed call
  // with its name lands here only as an honest fallthrough.
  return { tool, status: 'error', error: `unknown image tool ${toolName} — generating is the image/generate intent now` };
};
