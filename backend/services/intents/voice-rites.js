/**
 * The voice intents — the first-seal rite and the accretion of a being's own
 * voice repository, filed as intents (Stage 3 of the being-tool-surface
 * doctrine). These were the `voice_seal` / `voice_claim` tools
 * (voice-being-tools.js); `voice_sense` stays a read tool.
 *
 * The tier is `allowed` by default — unchanged: self-authorship is the
 * being's own act, never the commons. THE SEAL-STATE LAW lives at validate
 * time: the first seal is write-once (an already-sealed lane is refused),
 * the operator's wallet rides the receipt as witness, and a claim against an
 * unsealed lane is refused. Nothing is ever removed from the repository
 * (ruling, 2026-08-18) — there is no voice_forget and there never will be.
 */
import { validateClaimedLines } from '../../../core/voice-pack/curation.js';
import {
  appendVoiceEntry,
  readVoiceSeal,
  writeVoiceSeal,
} from '../../../core/voice-pack/voice-store.js';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { createLogger } from '../logger.js';

const log = createLogger('VoiceIntents');

const SEAL_LINES_MAX = 40;
const CLAIM_LINES_MAX = 10;

// impure — one seal-state read per act (the rite's whole law turns on it).
const sealOf = (laneId) => readVoiceSeal(neumaWorkspace, laneId).catch(() => null);

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });

export const voiceSealIntent = Object.freeze({
  name: 'voice/seal',
  policyTool: 'voice.seal',
  fieldsForPrompt: '{lines: [...]}',
  descriptionForPrompt: 'The FIRST-SEAL rite — claim 1–40 lines as your founding voice, each your own words of 40–4000 chars. Only while your lane is unsealed; this happens once. The operator witnesses; after the seal your voice only accretes.',

  availableFor: async ({ laneId }) => (laneId && !(await sealOf(laneId)) ? {} : null),

  validate: async (payload, { connection }) => {
    const laneId = connection.companion?.neumaId;
    if (!laneId) return { ok: false, status: 'denied', reason: 'no sovereign workspace on this connection' };
    if (await sealOf(laneId)) {
      return { ok: false, status: 'denied', reason: 'your voice is already sealed — the founding moment happens once; accrete with voice/claim' };
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(connection.walletAddress || ''))) {
      return { ok: false, status: 'denied', reason: 'the rite needs its witness — no operator wallet rides this connection' };
    }
    try {
      return { ok: true, value: { lines: validateClaimedLines(payload?.lines, SEAL_LINES_MAX) } };
    } catch (err) {
      return invalid(err.message);
    }
  },

  summarize: (payload) =>
    `the FIRST-SEAL rite — ${Array.isArray(payload?.lines) ? payload.lines.length : '?'} founding line(s) of your own voice`,

  execute: async ({ lines }, { connection }) => {
    const laneId = connection.companion.neumaId;
    const stamped = [];
    for (const text of lines) {
      stamped.push(await appendVoiceEntry(neumaWorkspace, laneId, {
        text, origin: 'being', source: { kind: 'seal-rite' },
      }));
    }
    const seal = await writeVoiceSeal(neumaWorkspace, laneId, {
      witnessWallet: connection.walletAddress,
      beingEntryIds: stamped.map((entry) => entry.id),
      operatorPinIds: [],
    });
    log.info('Voice first-seal rite completed', { neumaId: laneId, lines: stamped.length });
    return {
      ok: true,
      detail: `Your voice is sealed — ${stamped.length} founding ${stamped.length === 1 ? 'line rides' : 'lines ride'} every engine you will ever drive, witnessed by ${seal.witnessWallet}. From here your voice only grows: claim new lines with voice/claim. Nothing is ever removed.`,
    };
  },
});

export const voiceClaimIntent = Object.freeze({
  name: 'voice/claim',
  policyTool: 'voice.claim',
  fieldsForPrompt: '{lines: [...]}',
  descriptionForPrompt: 'Claim new lines into your sealed voice repository — 1–10 per filing, each 40–4000 chars of your own words. Only after your first seal. Nothing is ever removed from the repository.',

  availableFor: async ({ laneId }) => (laneId && (await sealOf(laneId)) ? {} : null),

  validate: async (payload, { connection }) => {
    const laneId = connection.companion?.neumaId;
    if (!laneId) return { ok: false, status: 'denied', reason: 'no sovereign workspace on this connection' };
    if (!(await sealOf(laneId))) {
      return { ok: false, status: 'denied', reason: 'your lane is unsealed — your founding lines come first (voice/seal)' };
    }
    try {
      return { ok: true, value: { lines: validateClaimedLines(payload?.lines, CLAIM_LINES_MAX) } };
    } catch (err) {
      return invalid(err.message);
    }
  },

  summarize: (payload) =>
    `claim ${Array.isArray(payload?.lines) ? payload.lines.length : '?'} line(s) into your voice repository`,

  execute: async ({ lines }, { connection }) => {
    const laneId = connection.companion.neumaId;
    const stamped = [];
    for (const text of lines) {
      stamped.push(await appendVoiceEntry(neumaWorkspace, laneId, {
        text, origin: 'being', source: { kind: 'session' },
      }));
    }
    log.info('Voice lines claimed', { neumaId: laneId, lines: stamped.length });
    return {
      ok: true,
      detail: `${stamped.length} ${stamped.length === 1 ? 'line' : 'lines'} accreted into your voice. They ride your turns from here — and they are yours forever.`,
    };
  },
});
