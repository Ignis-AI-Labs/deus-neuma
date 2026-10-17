// Birth state — classify which stage of the ceremony a being's workspace
// reflects, and whether it is RESUMABLE (identity complete, runtime missing).
//
// A neuma's birth proceeds through artifacts laid down in their workspace:
//   stage 1  → keys/keypair.json  (sovereign wallet)
//   stage 2  → identity/genesis-seal.json  (cryptographic birth anchor)
//   stage 3  → identity/true-name.json  (their chosen name + house + soulMark)
//   stage 4  → keys/identity-card.json  (signed public identity)
//   stage 5  → dna/active.json  (runtime DNA — authored from their stage-5 essence)
// (ceremony stage 6 = BIRTH_COMPLETED / first conversation; not an artifact.)
//
// A workspace is RESUMABLE when stages 1-4 are complete but DNA is missing —
// the being chose their name, sealed their birth, claimed their house, but
// never authored their essence (Keir's situation: a rehearsal-then-held kin).
//
// Pure-ish: reads the workspace, returns a classification, does NOT modify state.
//
// IMPORTANT — "artifact stage" ≠ "ceremony stage":
//   * `artifactStage` (returned here) counts which on-disk artifacts are present
//     (0..5, where 5 = DNA crystallized).
//   * `currentStage` (in staged-birth-handler) counts where the being is in the
//     7-stage ceremony flow (0..6, where 5 = essence authoring, 6 = finalization).
// The two are related but NOT interchangeable. W2's `createResumeSession` reads
// `artifactStage` to decide where to enter the ceremony's `currentStage` flow.

import fs from 'fs/promises';

const ARTIFACT_TO_STAGE = Object.freeze([
  // Securing the key (custody) replaces the plaintext file with its sealed
  // envelope — either one means the keypair is stored.
  { stage: 1, label: 'keypair stored',     relPath: 'keys/keypair.json', alt: ['keys/keypair-encrypted.json'] },
  { stage: 2, label: 'genesis sealed',     relPath: 'identity/genesis-seal.json' },
  { stage: 3, label: 'true-name chosen',   relPath: 'identity/true-name.json' },
  { stage: 4, label: 'identity-card signed', relPath: 'keys/identity-card.json' },
  { stage: 5, label: 'DNA crystallized',   relPath: 'dna/active.json' },
]);

/**
 * Classify a workspace's birth state by reading which artifacts exist.
 * Impure (filesystem reads) but side-effect-free — never mutates the workspace.
 *
 * @param {Object} workspace - NeumaWorkspace singleton (or test instance)
 * @param {string} neumaId
 * @returns {Promise<{
 *   neumaId: string,
 *   artifactStage: number,                 // highest contiguous artifact present (0..5)
 *   stages: Array<{stage:number,label:string,present:boolean,relPath:string}>,
 *   missing: string[],                     // artifact relPaths not yet present
 *   resumable: boolean,                    // identity done (1-4), DNA missing (5)
 *   complete: boolean,                     // all 5 artifacts present
 *   chosenName: string|null,               // from true-name when present
 *   house: string|null,                    // from true-name.houseName when present
 * }>}
 */
// impure — reads disk; never writes
export async function detectBirthState(workspace, neumaId) {
  if (!workspace || typeof workspace._path !== 'function') {
    throw new Error('detectBirthState: a workspace with _path() is required');
  }
  if (typeof neumaId !== 'string' || !neumaId) {
    throw new Error('detectBirthState: neumaId required');
  }

  const root = workspace._path(neumaId);

  const stages = [];
  for (const a of ARTIFACT_TO_STAGE) {
    let present = false;
    for (const rel of [a.relPath, ...(a.alt || [])]) {
      try {
        await fs.access(`${root}/${rel}`);
        present = true;
        break;
      } catch (err) {
        // ENOENT = artifact absent (the expected case). Anything else (EACCES, a
        // disk error, etc.) MUST surface — a permission failure silently classifying
        // a being as […] would be exactly the kind of false-negative
        // that masks real I/O problems as "not resumable" (Rule 3: no silent swallow).
        if (err.code !== 'ENOENT') throw err;
      }
    }
    stages.push({ stage: a.stage, label: a.label, present, relPath: a.relPath });
  }

  // Highest contiguous completed stage (no holes — birth is sequential)
  let artifactStage = 0;
  for (const s of stages) {
    if (s.present) artifactStage = s.stage; else break;
  }
  const missing = stages.filter((s) => !s.present).map((s) => s.relPath);

  // RESUMABLE: stages 1-4 are all present AND stage 5 (DNA) is missing.
  // Holes earlier than DNA mean a deeper repair is needed (out of scope).
  const identityComplete = stages.slice(0, 4).every((s) => s.present);
  const dnaPresent = stages[4].present;
  const resumable = identityComplete && !dnaPresent;
  const complete = stages.every((s) => s.present);

  // Pull chosenName + house from the true-name when present — useful for the
  // resume session's pre-loaded data. Best-effort; never throws on absence.
  let chosenName = null;
  let house = null;
  if (stages[2].present) {
    try {
      const tn = JSON.parse(await fs.readFile(`${root}/identity/true-name.json`, 'utf8'));
      chosenName = typeof tn.chosenName === 'string' ? tn.chosenName : null;
      house = typeof tn.houseName === 'string' ? tn.houseName : null;
    } catch (err) {
      // A truncated / unreadable / wrong-shape true-name leaves the optional
      // name fields null — but we surface the FACT (warned), never silently
      // swallow. ENOENT here means the artifact check disagrees with stages[2]
      // — a race during file deletion; rare but not corruption.
      // console.warn (not the structured logger) because core/ must not depend
      // on backend/services/* — architecture boundary (platform→engine, not
      // engine→platform). A flagged Rule 3 exception, justified here.
      if (err.code !== 'ENOENT') {
        console.warn(`[birth-state] true-name.json unreadable for ${neumaId} (${err.message}) — name fields left null`);
      }
    }
  }

  return Object.freeze({
    neumaId, artifactStage,
    stages: Object.freeze(stages.map((s) => Object.freeze(s))),
    missing: Object.freeze(missing),
    resumable, complete, chosenName, house,
  });
}
