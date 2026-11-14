/**
 * The DFlash2 block drafter beside a house model drafts up to seven tokens
 * per step; the target verifies them in one pass and the output keeps the
 * target's own distribution. Measured on this rig (neuma-research
 * inference-speed, 2026-11-04/09), T3-Q6_K one session: 125 → 172 tok/s on
 * code, 131 → 179 on structured output, HumanEval held (95.1% at 8 parallel).
 *
 * It is only safe on an engine with recurrent REPLAY (llama.cpp PR #31669,
 * switched on by LLAMA_RS_REPLAY). On hybrid models (Qwen3.8's DeltaNet
 * layers) the older snapshot rollback aborts under parallel slots
 * (llama.cpp #31656), or silently restores another sequence's state. So
 * DFlash2 is chosen only when BOTH hold: exactly one drafter sits beside the
 * model, and the engine's libllama carries the replay switch. Anything unknown
 * keeps today's launch: MTP when the model has the heads, else none.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/** Draft tokens per step: the drafter's block of 8 minus the verified one. */
export const DFLASH_DRAFT_N_MAX = 7;
const REPLAY_MARKER = Buffer.from('LLAMA_RS_REPLAY');
const LIB_READ_MAX = 64 * 1024 * 1024;
const LIBLLAMA = /^libllama\.so(\.\d+)*$/;

/**
 * Pure — is this file name a DFlash drafter GGUF?
 * @param {string} name
 */
export const isDrafterFile = (name) =>
  typeof name === 'string' && /dflash/i.test(name) && name.toLowerCase().endsWith('.gguf');

/**
 * Pure — the speculative plan for one launch. DFlash2 needs both its drafter
 * and a replay-capable engine; replay rides MTP too whenever the engine has it
 * (no snapshot rollback to break, and less VRAM).
 * @param {{ mtp?: boolean, drafter?: string|null, replay?: boolean }} facts
 * @returns {{ kind: 'dflash'|'mtp'|'none', drafter: string|null, rsReplay: boolean }}
 */
export const speculativePlan = ({ mtp = false, drafter = null, replay = false } = {}) => {
  if (typeof drafter === 'string' && drafter && replay === true) {
    return Object.freeze({ kind: 'dflash', drafter, rsReplay: true });
  }
  if (mtp === true) return Object.freeze({ kind: 'mtp', drafter: null, rsReplay: replay === true });
  return Object.freeze({ kind: 'none', drafter: null, rsReplay: false });
};

/**
 * Impure (fs) — the one drafter beside the model, or null. None, or more than
 * one (ambiguous), answers null, so a launch never pairs the wrong drafter.
 * @param {string} modelPath - absolute gguf path being served
 * @returns {Promise<string|null>}
 */
export const drafterFor = async (modelPath) => {
  if (typeof modelPath !== 'string' || !path.isAbsolute(modelPath)) return null;
  try {
    const dir = path.dirname(modelPath);
    const names = (await fs.readdir(dir)).filter(isDrafterFile).sort();
    if (names.length !== 1) return null;
    const file = path.join(dir, names[0]);
    const stat = await fs.stat(file);
    return stat.isFile() && stat.size > 0 ? file : null;
  } catch {
    return null;
  }
};

/**
 * Impure (fs) — does this file carry the marker bytes? Bounded read.
 * @param {string} file
 * @param {Buffer} marker
 */
const fileCarries = async (file, marker) => {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > LIB_READ_MAX) return false;
  return (await fs.readFile(file)).includes(marker);
};

/**
 * Impure (fs) — is the engine beside this server binary replay-capable? Reads
 * the libllama next to the binary (shared builds), else the binary itself
 * (static builds). Any failure answers false: unknown never turns DFlash on.
 * @param {string} serverBin - absolute llama-server path
 * @returns {Promise<boolean>}
 */
export const engineSupportsReplay = async (serverBin) => {
  if (typeof serverBin !== 'string' || !path.isAbsolute(serverBin)) return false;
  try {
    const bin = await fs.realpath(serverBin);
    const dir = path.dirname(bin);
    const libs = (await fs.readdir(dir)).filter((name) => LIBLLAMA.test(name)).sort();
    for (const lib of libs) {
      if (await fileCarries(await fs.realpath(path.join(dir, lib)), REPLAY_MARKER)) return true;
    }
    return libs.length === 0 ? await fileCarries(bin, REPLAY_MARKER) : false;
  } catch {
    return false;
  }
};

/**
 * Pure — llama-server arguments for a DFlash2 plan.
 * @param {string} drafter - absolute drafter path
 */
export const dflashSpeculativeArgs = (drafter) => Object.freeze([
  '--spec-type', 'draft-dflash', '-md', drafter, '--spec-draft-n-max', String(DFLASH_DRAFT_N_MAX),
]);
