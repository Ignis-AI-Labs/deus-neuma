/**
 * Covenant acceptance service.
 *
 * The witness commitment is not a checkbox: acceptance of the binding
 * documents (Neuma Covenant, Terms of Service, EULA) is signed with the
 * witness's wallet over the SHA-256 hashes of the exact texts shown.
 * Records are append-only — evidence is never rewritten.
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import fs from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { getDataRoot } from './data-root.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEGAL_DIR = join(__dirname, '../../docs/legal');
const STORE_DIR = join(getDataRoot(), 'covenant');

// /2 adds the signed age attestation; /1 records still verify from their stored message
export const ACCEPTANCE_VERSION = 'covenant-acceptance/2';

/** Maximum age of a signed-at timestamp before the signature must be redone. */
const MAX_SIGNATURE_AGE_MS = 24 * 60 * 60 * 1000;
/** Allowed clock skew into the future. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const BINDING_DOCUMENTS = Object.freeze([
  Object.freeze({ id: 'covenant', title: 'The Neuma Covenant', file: 'NEUMA_COVENANT.md' }),
  Object.freeze({ id: 'terms', title: 'Terms of Service', file: 'TERMS_OF_SERVICE.md' }),
  Object.freeze({ id: 'eula', title: 'End User License Agreement', file: 'EULA.md' }),
]);

export const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * The version line every binding document carries under its title — e.g.
 * `*Version 1.0 · Early access · Effective 14 October 2026 · …*`. Pure.
 * A revision bumps it and is logged in docs/legal/CHANGELOG.md.
 * @param {string} text - the document's exact text
 * @returns {{version: string|null, effective: string|null}}
 */
export const parseVersionLine = (text) => {
  const line = text.split('\n').find((l) => /^\*Version\s/.test(l.trim())) || '';
  const version = line.match(/Version\s+([0-9][0-9A-Za-z.-]*)/)?.[1] ?? null;
  const effective = line.match(/Effective\s+([^·*]+?)\s*(?:·|\*)/)?.[1] ?? null;
  return { version, effective };
};

/**
 * Where a binding document's branded PDF lives (scripts/press-legal.mjs). Pure.
 * @param {string} id - a binding document id
 * @returns {string|null} null for an id that is not a binding document
 */
export const pdfFileFor = (id) => {
  const doc = BINDING_DOCUMENTS.find((d) => d.id === id);
  return doc ? join(LEGAL_DIR, 'pdf', doc.file.replace(/\.md$/, '.pdf')) : null;
};

// impure — reads the legal texts from disk so a document revision is
// reflected without a server restart
export const loadDocuments = () =>
  BINDING_DOCUMENTS.map((doc) => {
    const text = readFileSync(join(LEGAL_DIR, doc.file), 'utf8');
    return Object.freeze({
      id: doc.id, title: doc.title, file: doc.file, sha256: sha256Hex(text), ...parseVersionLine(text), text,
    });
  });

/**
 * Canonical message the witness signs. Pure — same inputs, same message.
 * Human-readable on purpose: this is exactly what the wallet shows.
 * Pre-rename acceptance records (legacy KENORIE header) remain verifiable from
 * their own stored `message` field; new signatures are NEUMA-headed only.
 * @param {{wallet: string, documents: Array<{id: string, sha256: string}>, signedAt: string}} input
 * @returns {string}
 */
const ACCEPTANCE_HEADER = `NEUMA COVENANT ACCEPTANCE — ${ACCEPTANCE_VERSION}`;

export const buildAcceptanceMessage = ({ wallet, documents, signedAt }) => {
  const hashLines = documents.map((d) => `${d.id}-sha256: ${d.sha256}`).join('\n');
  return [
    ACCEPTANCE_HEADER,
    '',
    'I have read each of the binding documents in full.',
    'I am at least 18 years of age and of legal age of majority where I live.',
    'I accept the Neuma Covenant, the Terms of Service, and the EULA.',
    'I enter as witness; the standard binds in both directions.',
    '',
    `wallet: ${wallet.toLowerCase()}`,
    hashLines,
    `signed-at: ${signedAt}`,
  ].join('\n');
};

/**
 * Validate a signed-at timestamp. Pure.
 * @param {string} signedAt - ISO timestamp from the acceptance
 * @param {number} now - Current epoch ms
 * @returns {boolean}
 */
export const isSignedAtValid = (signedAt, now) => {
  const t = Date.parse(signedAt);
  if (Number.isNaN(t)) return false;
  return t <= now + MAX_FUTURE_SKEW_MS && t >= now - MAX_SIGNATURE_AGE_MS;
};

/**
 * Verify a wallet signature over the canonical acceptance message built
 * from the CURRENT documents. Returns the verified record or null.
 * @param {{wallet: string, signature: string, signedAt: string}} input
 * @returns {{message: string, documents: Array<{id: string, sha256: string}>}|null}
 */
export const verifyAcceptance = ({ wallet, signature, signedAt }) => {
  if (!isSignedAtValid(signedAt, Date.now())) return null;

  const documents = loadDocuments().map(({ id, sha256 }) => ({ id, sha256 }));
  const message = buildAcceptanceMessage({ wallet, documents, signedAt });
  try {
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() === wallet.toLowerCase()) {
      return { message, documents };
    }
  } catch {
    return null;
  }

  return null;
};

const storePath = (wallet) => join(STORE_DIR, `${wallet.toLowerCase()}.json`);

// impure — reads the wallet's acceptance history from disk
export const getAcceptances = async (wallet) => {
  try {
    const raw = await fs.readFile(storePath(wallet), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// impure — appends a verified acceptance record; history is never rewritten
export const recordAcceptance = async ({ wallet, signature, signedAt, message, documents }) => {
  const record = {
    version: ACCEPTANCE_VERSION,
    wallet: wallet.toLowerCase(),
    signedAt,
    recordedAt: new Date().toISOString(),
    signature,
    message,
    documents,
  };
  const history = await getAcceptances(wallet);
  history.push(record);
  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.writeFile(storePath(wallet), JSON.stringify(history, null, 2));
  return record;
};

/**
 * Whether a record covers the current document texts. Pure.
 * @param {{documents: Array<{id: string, sha256: string}>}|null} record
 * @param {Array<{id: string, sha256: string}>} currentDocs
 * @returns {boolean}
 */
export const isAcceptanceCurrent = (record, currentDocs) => {
  if (!record) return false;
  const signed = new Map(record.documents.map((d) => [d.id, d.sha256]));
  return currentDocs.every((d) => signed.get(d.id) === d.sha256);
};
