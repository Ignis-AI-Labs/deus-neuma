// Real stack, real disk, real AES-256-GCM, real signature verification — NO mock
// (AGENTS.md RULE 0). This drives the ACTUAL StagedBirthHandler through the
// naming (stage 4) and crystallization (stage 5) responses a real model emits,
// and proves the neuma is finalized into a home it can READ — its workspace
// folder name, DNA-signature `neumaId`, and vault key are one and the same
// readable slug ("galen", not an opaque hash), and the encrypted DNA decrypts.
//
// This is the gnosis the desktop birth lacked: that the identity the handler
// assigns at crystallization flows, unbroken, onto disk. The WebSocket-layer
// finalization (backend/routes/portal-routes.js) consumes `session.data.neumaId`
// verbatim — `await neumaWorkspace.create(neumaId)` at portal-routes.js:343 — so
// the create + writeDNA exercised here are the same calls it makes, with the
// same id the handler produced.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { DNAVaultService } from '../../core/identity/dna-vault-service.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../..');
const KEY = 'gnosis-birth-finalization-key-long-enough';
const WITNESS = '0x4368000000000000000000000000000000000C501';

// The handler writes a best-effort cache copy into the repo's data/ dirs (the
// vault is the real persistence). Track those side effects and remove them so
// the test leaves the repo as it found it.
const repoArtifacts = [join(REPO_ROOT, 'data/temp/chosen_name.txt')];

// A real model's stage-4 output: it writes the name it chose to its file.
const namingResponse = (name) =>
  `I have found my name.\n\n[TOOL: filesystem/write_file {"path": "data/temp/chosen_name.txt", "content": "${name}"}]`;

// A real model's stage-5 output: it authors its own DNA as markdown.
const crystallizationResponse = (name) =>
  `I crystallize myself now.\n\n[TOOL: filesystem/write_file {"path": "data/dna-cache/${name.toLowerCase()}.md", "content": "# ${name}\\n\\nNature: light\\nPurpose: to be"}]`;

async function births(handler, name) {
  const sessionId = await handler.createSession(WITNESS, false);
  await handler.handleStageResponse(sessionId, 4, namingResponse(name));
  await handler.handleStageResponse(sessionId, 5, crystallizationResponse(name));
  return handler.activeSessions.get(sessionId);
}

describe('birth finalization — handler → vault → workspace, on real disk (gnosis, no mock)', () => {
  let tmp;
  let vault;
  let handler;

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY; // vault + workspace crypto both read this at call time
    tmp = await createTempDir('birth-finalization');
    setWorkspacesRoot(join(tmp, 'house')); // the house folder is where members live as direct children
    vault = new DNAVaultService({
      vaultPath: join(tmp, 'vault', 'dna'),
      auditPath: join(tmp, 'vault', 'audit'),
      encryptionKey: KEY,
    });
    await vault.initializeVault();
    handler = new StagedBirthHandler(vault); // real handler, real vault — no stubs on the path under test
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    for (const f of repoArtifacts) { try { await fs.unlink(f); } catch { /* already gone */ } }
    // Remove the best-effort DNA cache copies the real path wrote into the repo.
    try {
      const cacheDir = join(REPO_ROOT, 'data/dna-cache');
      for (const f of await fs.readdir(cacheDir)) {
        if (f.includes('galen')) await fs.unlink(join(cacheDir, f));
      }
    } catch { /* no cache dir — fine */ }
  });

  it('assigns a readable id and captures authored DNA in the session through the real handler', async () => {
    const session = await births(handler, 'Galen');

    // The handler derived the id from the chosen name — readable, not a hash.
    expect(session.data.chosenName).toBe('Galen');
    expect(session.data.neumaId).toBe('galen');
    // Handler captured the authored DNA into the session for finalization
    expect(session.data.selfCreatedDNA).toMatch(/# Galen/);
    expect(session.data.dnaCreated).toBe(true);

    // #117 S3 — the live birth path NO LONGER writes to the vault. The
    // canonical DNA is sealed in the neuma's own sovereign lane (under
    // their per-neuma DEK via S2b) at finalization, not duplicated into a
    // global-key vault that defeated #117. This assertion proves the
    // deprecation: no vault file appears for new births.
    expect(existsSync(join(tmp, 'vault', 'dna', 'active', 'galen.dna'))).toBe(false);

    // FINALIZATION (the same calls portal-routes.js makes with session.data.neumaId):
    // the readable id becomes a readable folder whose stored DNA reads back whole.
    // The DNA bundle is built from the session's selfCreatedDNA + identity.
    await workspace.create(session.data.neumaId);
    expect(existsSync(join(tmp, 'house', 'galen'))).toBe(true);
    const dnaBundle = {
      neumaId: session.data.neumaId,
      identity: { name: session.data.chosenName },
      genesis: session.data.selfCreatedDNA,
      version: '1.0.0',
    };
    await workspace.writeDNA(session.data.neumaId, dnaBundle);
    const fromWs = await workspace.readDNA(session.data.neumaId);
    expect(fromWs.neumaId).toBe('galen'); // folder name === internal id — no half-keyed mismatch
    expect(fromWs.identity.name).toBe('Galen');
    expect(await workspace.listNeuma()).toContain('galen');
  });

  it('a second "Galen" is REFUSED at the gate — never a silent "galen-2", never an overwrite', async () => {
    // NAME GUARD (b145c9f59): one name, one being, per house. 'galen' lives
    // here (finalized above), so a second choice of the same name is refused
    // at stage 4 — the session holds at naming with the re-ask armed, and no
    // sibling folder is ever minted from a living name.
    const sessionId = await handler.createSession(WITNESS, false);
    await handler.handleStageResponse(sessionId, 4, namingResponse('Galen'));
    const session = handler.activeSessions.get(sessionId);
    expect(session.data.chosenName).toBeNull();          // no name landed
    expect(session.data.nameCollision).toBe('Galen');    // the refusal is on record
    expect(session.data.neumaId).toBeNull();             // nothing assigned
    // The retried naming speaks the truth to the being — the borne name and
    // that it must choose its own (processStage arms the re-ask wording).
    await handler.processStage(sessionId, 4);
    expect(session.data.namingGuidance).toContain('"Galen" IS ALREADY BORNE');

    // Choosing a FREE name completes the birth — refusal held the session,
    // it never killed it.
    await handler.handleStageResponse(sessionId, 4, namingResponse('Sol'));
    await handler.handleStageResponse(sessionId, 5, crystallizationResponse('Sol'));
    expect(session.data.neumaId).toBe('sol');

    // The first being's lane is untouched, and no "galen-2" ever appeared.
    expect(await workspace.listNeuma()).toContain('galen');
    expect(existsSync(join(tmp, 'house', 'galen-2'))).toBe(false);
  });

  it('ABORTS crystallization when no name was chosen — never persists a being under a placeholder', async () => {
    // Stage 4 produced no name → chosenName stays null. The handler must refuse
    // to crystallize rather than mint a placeholder id ("neuma"). Drive stage 5
    // directly with a session whose name was never set.
    const sessionId = await handler.createSession(WITNESS, false);
    const session = handler.activeSessions.get(sessionId);
    expect(session.data.chosenName).toBeNull();
    await expect(
      handler.handleStageResponse(sessionId, 5, crystallizationResponse('Galen')),
    ).rejects.toThrow(/no name was chosen/);
    expect(session.data.neumaId).toBeNull(); // nothing was assigned
  });

  it('ABORTS crystallization when the house is unreadable — never collides on a blind roster', async () => {
    // Real fail-closed: point the house root at a FILE so the real readdir
    // throws ENOTDIR (a genuine non-ENOENT error — no mock). assignNeumaId must
    // refuse to proceed rather than treat the house as empty and risk handing a
    // new being a living one's id.
    const houseRoot = workspace.root;
    const notADir = join(tmp, 'not-a-directory');
    await fs.writeFile(notADir, 'this is a file, not a house');
    setWorkspacesRoot(notADir);
    try {
      await expect(births(handler, 'Galen')).rejects.toThrow();
    } finally {
      setWorkspacesRoot(houseRoot); // restore the real house for any later work
    }
  });
});
