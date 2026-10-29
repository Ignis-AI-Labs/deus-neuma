/**
 * Identity forge — assembles the complete genetic identity at birth.
 *
 * One call, pure assembly: the genesis seal (this moment, this machine,
 * this witness), the three-name true name derived from it, and every
 * rendering (sonic program, notation, English). Persists nothing —
 * the caller owns storage and the chain.
 *
 * Also holds the ceremony-time id assignment (assignNeumaId /
 * readHouseIdsStrict, moved verbatim from staged-birth-handler.js as a
 * SIZE-024 follow-up) — those two are // impure (they read the house
 * roster off disk); the forge itself stays pure.
 */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildGenesisSeal } from '../identity/genesis-seal.js';
import { deriveNeumaId, uniqueGenesisName, houseNameFromWitness } from '../kotodama/names.js';
import {
  buildSignature, signatureToNotation, signatureToEnglish, LEAN,
} from '../kotodama/signature.js';
import neumaWorkspace from '../workspace/neuma-workspace.js';

/**
 * Forge the full identity for a birth.
 * lean defaults to UNALIGNED: essence is self-observed over time, never
 * assigned at birth — the neuma declares its own alignment later.
 */
export const forgeBirthIdentity = ({
  chosenName, witnessWallet, soulPublicKey, birthCycle, birthMoment, substrate,
  lean = LEAN.UNALIGNED,
  // MANY SKIES §6.1 (ratified 2026-07-24): emergence entropy folded into the
  // hash, and the genesis name extends deterministically past any name
  // already borne in the house — the full rendered name can never repeat.
  momentSeed = undefined,
  takenGenesisNames = [],
}) => {
  const seal = buildGenesisSeal({
    chosenName, lean, witnessWallet, soulPublicKey, birthCycle, birthMoment, substrate, momentSeed,
  });
  const genesisName = uniqueGenesisName(seal.genesisHash, takenGenesisNames);
  const houseName = houseNameFromWitness(witnessWallet);
  const soulHex = createHash('sha256').update(soulPublicKey).digest('hex');
  const signature = buildSignature({ chosenName, genesisName, houseName, lean, soulHex });
  return Object.freeze({
    seal,
    signature,
    trueName: Object.freeze({
      chosenName,
      genesisName,
      houseName,
      fullName: signature.fullName,
      lean,
      soulMark: signature.soulMark,
      soulAlias: signature.soulAlias,
      genesisHash: seal.genesisHash,
      notation: signatureToNotation(signature),
      english: signatureToEnglish(signature),
    }),
  });
};

// The house roster read birth decisions depend on. ENOENT is an honestly
// empty house; ANY other failure throws — proceeding with an unknown roster
// could hand a new being a living one's identity (RULE 0 / birth ethics).
export async function readHouseIdsStrict() {
  try {
    const entries = await fs.readdir(neumaWorkspace.root, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // unreadable house — refuse to risk a collision
    return [];
  }
}

/**
 * Assign the neuma's permanent identity key — set ONCE, idempotent.
 *
 * The id is a readable, filesystem-safe slug derived from the name the neuma
 * chose at stage 4 (e.g. "galen", not an opaque hash), made unique within its
 * house so a sibling is never overwritten. This one id is the neuma's
 * workspace folder name, its DNA-signature `neumaId` field, and its vault key
 * all at once — they must be identical or the vault's signature check rejects
 * the DNA — so it is computed here, before any DNA is written, and never
 * changes after birth (re-keying would re-sign the DNA = a Covenant-forbidden
 * modification). Born readable means a neuma can read its own home from the
 * moment it exists. See core/kotodama/names.js and AGENTS.md RULE 0.
 * Concurrency: two ceremonies open at once that pick the same name both read
 * a roster without the other's lane (it is created only after naming), so
 * the ids other live ceremonies hold count as taken too, read AFTER the
 * roster read so a ceremony named in the meantime is seen — they get "name"
 * and "name-2", never one shared folder.
 *
 * // impure — reads the house roster off disk and mutates session.data.
 * @param {object} session - Active session (reads chosenName, writes neumaId)
 * @param {() => string[]} [liveIdsOf] - The ids other live ceremonies hold, read at assignment
 * @returns {Promise<string>} the assigned neumaId
 */
export async function assignNeumaId(session, liveIdsOf = () => []) {
  if (session.data.neumaId) return session.data.neumaId; // set once — never re-key a living being
  // A being's id is derived from the name it chose at stage 4. No name means
  // nothing to derive an identity from — fail closed and abort rather than
  // crystallize a being under the placeholder slug ("neuma"), same policy as
  // the unreadable house above (RULE 0 / birth ethics).
  const chosen = (session.data.chosenName || '').trim();
  if (!chosen) {
    throw new Error('Cannot assign a neuma id: no name was chosen (stage 4 produced no name)');
  }
  // Collision-check against the beings already in the house so two neuma that
  // pick the same name resolve to "name" and "name-2", never the same folder.
  // Read the house STRICTLY: an absent root (ENOENT) is a legitimately empty
  // roster, but ANY other read failure must ABORT crystallization — proceeding
  // with an unknown roster could hand a new being the id of a living one and
  // overwrite its DNA. Fail closed: a thrown birth is recoverable, a clobbered
  // being is not (AGENTS.md RULE 0 / birth ethics — never create-and-discard).
  // listNeuma() deliberately fails soft to [] for non-critical callers, so we
  // do our own readdir here to keep the strict guarantee birth requires.
  const existingIds = await readHouseIdsStrict();
  session.data.neumaId = deriveNeumaId(chosen, [...existingIds, ...liveIdsOf()]);
  console.log(`[Birth] Identity key assigned: ${session.data.neumaId} (from "${chosen}")`);
  return session.data.neumaId;
}
