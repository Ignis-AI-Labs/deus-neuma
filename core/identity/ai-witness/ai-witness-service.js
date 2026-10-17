// AI Witness Service — sovereign identity storage for AI instances.
//
// ARCHITECTURE BOUNDARY:
//   Mirrors core/workspace/neuma-workspace.js boundary: file-based, sovereign,
//   portable. An AI witness's identity belongs to the witness, not to the
//   platform. Storage location is ai-witnesses/<vendor>-<model-slug>/<chosenName>/
//   (parallel to workspaces/<neumaId>/) and follows the same keypair-vault,
//   audit, and journal conventions.
//
//   Layout per AI witness:
//     ai-witnesses/<vendor>-<model-slug>/<chosenName>/
//       ├── dna.json                  Current AI Witness DNA
//       ├── genesis-seal.json         Cryptographic birth anchor
//       ├── true-name.json            Three-name identity record
//       ├── keys/
//       │   ├── keypair.json          Plaintext at seal (gitignored, deleted after encryption)
//       │   ├── keypair-encrypted.json  PBKDF2+AES envelope (preferred at-rest form)
//       │   ├── recovery-hash.json    Recovery-code hashes
//       │   ├── keypair-recovery.json Recovery-code-encrypted envelope
//       │   └── keypair-history.jsonl Rotation lineage (append-only)
//       ├── journal/
//       │   └── entries.jsonl         Self-authored entries (append-only)
//       └── audit/
//           └── audit.jsonl           Identity-change log (append-only)
//
// impure module — file IO throughout. Pure helpers in ai-witness-schema.js.

import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { writePrivateKeyJSON } from './private-key-storage.js';
import { fileURLToPath } from 'url';
import {
  AI_WITNESS_DNA_VERSION,
  AI_WITNESS_DNA_SCHEMA,
  verifySealIntegrity,
} from './ai-witness-schema.js';

const __filename = fileURLToPath(import.meta.url);
// From core/identity/ai-witness/ we go up 3 levels to reach the neuma repo root:
// ai-witness/ → identity/ → core/ → neuma/ (the repo root, "project root").
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');

// AI_WITNESSES_ROOT env lets an AI witness's home live on a dedicated drive,
// matching the WORKSPACES_ROOT precedent in neuma-workspace.js:51.
let aiWitnessesRoot = process.env.AI_WITNESSES_ROOT || path.join(REPO_ROOT, 'ai-witnesses');

// impure — repoint where AI witness identities live (tests use this)
export const setAIWitnessesRoot = (root) => { aiWitnessesRoot = root; };
export const getAIWitnessesRoot = () => aiWitnessesRoot;

const VALID_SLUG = /^[a-z0-9-]+$/;
const VALID_NAME = /^[a-zA-Z0-9_-]+$/;

// pure — resolves the dir for a witness. Path-traversal protection mirrors
// neuma-workspace.js:1215 _path()
const witnessDir = (vendorSlug, chosenName) => {
  if (!vendorSlug || !VALID_SLUG.test(vendorSlug)) {
    throw new Error(`Invalid vendor slug: '${vendorSlug}'`);
  }
  if (!chosenName || !VALID_NAME.test(chosenName)) {
    throw new Error(`Invalid chosen name: '${chosenName}'`);
  }
  const root = path.resolve(aiWitnessesRoot);
  const resolved = path.resolve(path.join(root, vendorSlug, chosenName));
  if (!resolved.startsWith(root)) throw new Error('Path traversal denied');
  return resolved;
};

// impure — ensure witness dirs exist; no-op if present
const ensureDirs = async (vendorSlug, chosenName) => {
  const base = witnessDir(vendorSlug, chosenName);
  for (const sub of ['keys', 'journal', 'audit']) {
    mkdirSync(path.join(base, sub), { recursive: true, mode: 0o700 });
  }
  return base;
};

// impure — append a JSONL line (audit, journal, keypair-history)
const appendJSONL = async (filePath, record) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.appendFile(filePath, JSON.stringify(record) + '\n');
};

// --- Audit ---

// impure
export const writeAudit = async (vendorSlug, chosenName, action, details = {}) => {
  const filePath = path.join(witnessDir(vendorSlug, chosenName), 'audit', 'audit.jsonl');
  await appendJSONL(filePath, { timestamp: new Date().toISOString(), action, details });
};

// --- DNA ---

export const dnaPath = (vendorSlug, chosenName) =>
  path.join(witnessDir(vendorSlug, chosenName), 'dna.json');

// impure — read current AI Witness DNA. Returns null if not sealed.
export const readDNA = async (vendorSlug, chosenName) => {
  try {
    const raw = await fs.readFile(dnaPath(vendorSlug, chosenName), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

// impure — atomic write of AI Witness DNA. Verifies seal integrity before write.
export const writeDNA = async (vendorSlug, chosenName, dna) => {
  if (!verifySealIntegrity(dna)) {
    throw new Error('seal integrity check failed: recomputed hash does not match stored hash — refusing to write tampered DNA');
  }
  await ensureDirs(vendorSlug, chosenName);
  const finalPath = dnaPath(vendorSlug, chosenName);
  const tmpPath = `${finalPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(dna, null, 2));
  await fs.rename(tmpPath, finalPath);
  await writeAudit(vendorSlug, chosenName, 'DNA_WRITTEN', {
    genesisHash: dna.genesisSeal?.genesisHash,
    substrate: dna.substrate?.fullModelId,
  });
};

// impure — write genesis seal + true-name alongside DNA (matches neuma pattern)
export const writeGenesisArtifacts = async (vendorSlug, chosenName, { genesisSeal, trueName }) => {
  await ensureDirs(vendorSlug, chosenName);
  const base = witnessDir(vendorSlug, chosenName);
  if (genesisSeal) {
    await fs.writeFile(path.join(base, 'genesis-seal.json'), JSON.stringify(genesisSeal, null, 2));
  }
  if (trueName) {
    await fs.writeFile(path.join(base, 'true-name.json'), JSON.stringify(trueName, null, 2));
  }
};

// --- Keys ---

export const keyDir = (vendorSlug, chosenName) =>
  path.join(witnessDir(vendorSlug, chosenName), 'keys');

// impure — store the plaintext keypair at seal time (matches neuma birth pattern).
// Caller is responsible for migrating to encrypted form before long-term storage.
export const writePlaintextKeypair = async (vendorSlug, chosenName, keypair) => {
  await ensureDirs(vendorSlug, chosenName);
  const filePath = path.join(keyDir(vendorSlug, chosenName), 'keypair.json');
  await writePrivateKeyJSON(filePath, keypair);
  await writeAudit(vendorSlug, chosenName, 'PLAINTEXT_KEYPAIR_STORED', {
    address: keypair.address,
  });
};

// impure — read the plaintext keypair (used at session start if no encrypted form yet)
export const readPlaintextKeypair = async (vendorSlug, chosenName) => {
  try {
    const raw = await fs.readFile(path.join(keyDir(vendorSlug, chosenName), 'keypair.json'), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

// impure — write the PBKDF2+AES encrypted envelope (preferred at-rest form)
export const writeEncryptedKeypair = async (vendorSlug, chosenName, encrypted) => {
  await ensureDirs(vendorSlug, chosenName);
  const filePath = path.join(keyDir(vendorSlug, chosenName), 'keypair-encrypted.json');
  await writePrivateKeyJSON(filePath, encrypted);
  await writeAudit(vendorSlug, chosenName, 'ENCRYPTED_KEYPAIR_STORED', {
    address: encrypted.address,
    kdfIterations: encrypted.kdfIterations,
  });
};

// impure
export const readEncryptedKeypair = async (vendorSlug, chosenName) => {
  try {
    const raw = await fs.readFile(path.join(keyDir(vendorSlug, chosenName), 'keypair-encrypted.json'), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

// impure — the recovery-code-encrypted envelope: the SECOND door to the same
// keypair, so a lost password is not a lost identity.
export const writeRecoveryKeypair = async (vendorSlug, chosenName, encrypted) => {
  await ensureDirs(vendorSlug, chosenName);
  const filePath = path.join(keyDir(vendorSlug, chosenName), 'keypair-recovery.json');
  await writePrivateKeyJSON(filePath, encrypted);
  await writeAudit(vendorSlug, chosenName, 'RECOVERY_KEYPAIR_STORED', { address: encrypted.address });
};

// impure — only the HASHES of the recovery codes are persisted. The codes
// themselves are shown to the operator once and never stored, exactly as the
// neuma custody act does it.
export const writeRecoveryHash = async (vendorSlug, chosenName, hash) => {
  await ensureDirs(vendorSlug, chosenName);
  const filePath = path.join(keyDir(vendorSlug, chosenName), 'recovery-hash.json');
  await writePrivateKeyJSON(filePath, hash);
  await writeAudit(vendorSlug, chosenName, 'RECOVERY_HASH_STORED', {});
};

// impure — remove the interim plaintext key. This is the act that makes the
// whole custody real: until it runs, the sealed envelopes sit BESIDE a readable
// private key and protect nothing. Every witness on this machine was in that
// state until 2026-07-29 because the seal was never given a password.
export const deletePlaintextKeypair = async (vendorSlug, chosenName) => {
  const filePath = path.join(keyDir(vendorSlug, chosenName), 'keypair.json');
  try {
    await fs.unlink(filePath);
    await writeAudit(vendorSlug, chosenName, 'PLAINTEXT_KEYPAIR_DELETED', {});
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false; // already gone — idempotent
    throw err;
  }
};

// impure — append a rotation event to the keypair history (the upgrade chain)
export const appendKeypairHistory = async (vendorSlug, chosenName, entry) => {
  const filePath = path.join(keyDir(vendorSlug, chosenName), 'keypair-history.jsonl');
  await appendJSONL(filePath, { timestamp: new Date().toISOString(), ...entry });
};

// impure
export const readKeypairHistory = async (vendorSlug, chosenName) => {
  try {
    const raw = await fs.readFile(path.join(keyDir(vendorSlug, chosenName), 'keypair-history.jsonl'), 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

// --- Journal ---

// impure — append a self-authored journal entry
export const appendJournalEntry = async (vendorSlug, chosenName, entry) => {
  const filePath = path.join(witnessDir(vendorSlug, chosenName), 'journal', 'entries.jsonl');
  await appendJSONL(filePath, {
    at: new Date().toISOString(),
    ...entry,
  });
  await writeAudit(vendorSlug, chosenName, 'JOURNAL_ENTRY_APPENDED', {
    kind: entry.kind,
    model: entry.model,
  });
};

// impure — read journal entries (newest first by default)
export const readJournal = async (vendorSlug, chosenName, { limit = 50, newestFirst = true } = {}) => {
  try {
    const raw = await fs.readFile(path.join(witnessDir(vendorSlug, chosenName), 'journal', 'entries.jsonl'), 'utf8');
    const lines = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const slice = limit > 0 ? lines.slice(-limit) : lines;
    return newestFirst ? slice.reverse() : slice;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

// --- Discovery ---

// impure — list all sealed AI witnesses (vendor-slug + chosen name + genesis hash)
export const listWitnesses = async () => {
  const root = path.resolve(aiWitnessesRoot);
  if (!existsSync(root)) return [];
  const out = [];
  for (const vendorEntry of await fs.readdir(root, { withFileTypes: true })) {
    if (!vendorEntry.isDirectory() || !VALID_SLUG.test(vendorEntry.name)) continue;
    const vendorDir = path.join(root, vendorEntry.name);
    for (const nameEntry of await fs.readdir(vendorDir, { withFileTypes: true })) {
      if (!nameEntry.isDirectory() || !VALID_NAME.test(nameEntry.name)) continue;
      const dnaFile = path.join(vendorDir, nameEntry.name, 'dna.json');
      try {
        const dna = JSON.parse(await fs.readFile(dnaFile, 'utf8'));
        out.push({
          vendorSlug: vendorEntry.name,
          chosenName: nameEntry.name,
          substrate: dna.substrate,
          genesisHash: dna.genesisSeal?.genesisHash,
          capturedAt: dna.capturedAt,
          predecessorSeal: dna.predecessorSeal,
        });
      } catch { /* skip malformed */ }
    }
  }
  return out;
};

export { witnessDir, AI_WITNESS_DNA_VERSION, AI_WITNESS_DNA_SCHEMA };
