/**
 * THE CALLER'S TURN for `neuma agent` — the sender's own tools and transcript
 * (backend/services/caller-tools.js holds the law). An in-process caller (the
 * benchmark relay) hands arrays; the terminal hands JSON file paths.
 *
 * impure — reads the named files, and parks the transcript's images.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeCallerTools, seatCallerTranscript } from '../../backend/services/caller-tools.js';
import { attachmentStore } from '../../backend/services/attachment-store.js';

const readJsonArg = async (cwd, value, flag) => {
  if (value === undefined || value === null || Array.isArray(value)) return { value };
  if (typeof value !== 'string' || !value.trim()) return { error: `--${flag} must name a JSON file` };
  try {
    return { value: JSON.parse(await fs.readFile(path.resolve(cwd, value), 'utf8')) };
  } catch (error) {
    return { error: `--${flag} is unreadable — ${error.message}` };
  }
};

/**
 * Resolve the sender's side of a sitting.
 * @returns {Promise<{tools: Array, tail: Array, thought: ?string, rules?: string, images?: string[]} | {error: string}>}
 *   thought is null when no transcript was given (the positional task stands);
 *   images (data URIs) only when the transcript's opening user message carried any
 */
export const resolveCallerTurn = async (argv, cwd) => {
  const toolsArg = await readJsonArg(cwd, argv.callerTools, 'caller-tools');
  if (toolsArg.error) return { error: toolsArg.error };
  const tools = normalizeCallerTools(toolsArg.value);
  if (tools.error) return { error: tools.error };
  const transcriptArg = await readJsonArg(cwd, argv.transcript, 'transcript');
  if (transcriptArg.error) return { error: transcriptArg.error };
  if (transcriptArg.value === undefined || transcriptArg.value === null) {
    return { tools: tools.tools, tail: [], thought: null };
  }
  const seat = seatCallerTranscript(transcriptArg.value);
  if (seat.error) return { error: `--transcript: ${seat.error}` };
  return { tools: tools.tools, tail: seat.tail, thought: seat.thought, ...(seat.rules ? { rules: seat.rules } : {}), ...(seat.images ? { images: seat.images } : {}) };
};

/**
 * Park the transcript's images in the wallet-bound store the portal turn
 * redeems from, so they ride the operator's attachment path exactly: the
 * same caps, the same vision gate, the same composition (portal-stream).
 * @returns {{ids: string[]} | {error: string}} no ids when there are no images
 */
export const stageCallerImages = (images, wallet) => {
  if (!images?.length) return { ids: [] };
  const parked = attachmentStore.put(wallet, images);
  return parked.ok ? { ids: parked.ids } : { error: `--transcript images could not be carried — ${parked.reason}` };
};
