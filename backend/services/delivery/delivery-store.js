// The delivery door's record and its one write outward, per house, in the
// Mercator's office (`<realm>/<wallet>/offices/revenue/`): `delivery.json`
// holds the operator's destination, `deliveries.jsonl` every published thing.
// A file is taken only from inside the house ground (its real path, so a
// symlink cannot walk out), a regular file under FILE_MAX_BYTES; an invoice
// is rendered from the Quaestor's record, never from a file.
// impure.

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { officeFile } from '../house-office.js';
import { readJson, writePrivate, ABSENT } from '../house-office-legacy.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { destinationOf, placeOf, foldDeliveries, FILE_MAX_BYTES } from './delivery-shape.js';

const destFile = (wallet) => officeFile(wallet, 'revenue', 'delivery.json');
const recordFile = (wallet) => officeFile(wallet, 'revenue', 'deliveries.jsonl');

/** The operator's destination, or null. */
export const readDestination = async (wallet) => {
  const doc = await readJson(destFile(wallet));
  return doc === ABSENT || !doc?.folder ? null : doc;
};

/** The operator sets the destination: a folder that exists and takes writes, and its https address. */
export const setDestination = async (wallet, { folder, linkBase, by, now }) => {
  let destination;
  try {
    destination = destinationOf({ folder, linkBase });
    if (!(await fs.stat(destination.folder)).isDirectory()) throw new Error('folder: that path is not a folder');
    await fs.access(destination.folder, fs.constants.W_OK);
  } catch (error) {
    return { ok: false, reason: error.code ? `folder: ${destination?.folder ?? folder} cannot be written (${error.code})` : error.message };
  }
  const set = { ...destination, by, setAt: now };
  await writePrivate(destFile(wallet), set);
  return { ok: true, destination: set };
};

/** Every delivery of the house, oldest first. */
export const readDeliveries = async (wallet) => foldDeliveries((await readJsonLines(recordFile(wallet))).records);

/**
 * A file on the house ground, by its path there — or the refusal.
 * @returns {Promise<{ok: true, file: string, name: string, size: number} | {ok: false, reason: string}>}
 */
export const groundFile = async (groundRoot, rel) => {
  const asked = String(rel ?? '').trim();
  if (!asked || path.isAbsolute(asked)) return { ok: false, reason: 'path: where the work lies on the house ground, e.g. repos/<company>/delivery/report.pdf' };
  try {
    const root = await fs.realpath(groundRoot);
    const file = await fs.realpath(path.join(root, asked));
    if (!file.startsWith(`${root}${path.sep}`)) return { ok: false, reason: 'that path leads outside the house ground' };
    const st = await fs.stat(file);
    if (!st.isFile()) return { ok: false, reason: 'that path is not a file' };
    if (st.size > FILE_MAX_BYTES) return { ok: false, reason: `the file is ${Math.round(st.size / 1048576)} MB; the door takes ${FILE_MAX_BYTES / 1048576} MB at most` };
    return { ok: true, file, name: path.basename(file), size: st.size };
  } catch {
    return { ok: false, reason: `no file at ${asked} on the house ground` };
  }
};

/**
 * Publish one thing for a deal: the bytes written under an unguessable path
 * in the operator's folder, the delivery recorded. `body` is the bytes (a
 * ground file read, or an invoice's rendered page).
 */
export const publish = async (wallet, { destination, deal, company, kind, name, body, invoiceId = null, by, now }) => {
  const token = crypto.randomBytes(12).toString('hex');
  const { file, link } = placeOf(destination, { company, token, name });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, { flag: 'wx' });
  const delivery = Object.freeze({
    id: `p-${crypto.randomBytes(4).toString('hex')}`, dealId: deal.id, buyer: deal.buyer, companyId: deal.companyId, kind, name, invoiceId, link, by, publishedAt: now,
  });
  await appendJsonLine(recordFile(wallet), { type: 'published', delivery, at: now });
  return delivery;
};
