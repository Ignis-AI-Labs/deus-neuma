// Attachment staging for the CLI harness — files on disk → single-use ids.
//
// The desk uploads pasted images over HTTP; the CLI seat runs in-process, so
// staging parks payloads DIRECTLY in the same wallet-bound store the portal
// turn redeems from (`redeemAttachments` → attachment-store.js). Same
// sanitizers, same caps, same all-or-nothing batch law: the neuma is never
// told it saw part of what the operator attached.
//
// impure where it touches disk or the store; classification helpers are pure.

import { readFile } from 'node:fs/promises';
import {
  attachmentStore,
  sanitizeImages,
  sanitizeTextDocs,
  sanitizeImageDataUri,
} from '../../backend/services/attachment-store.js';

// Extension → the vision path's accepted mime. SVG is deliberately absent —
// it is a document that can script, not a picture (attachment-store law).
const IMAGE_MIME = Object.freeze({
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
  '.gif': 'gif',
});

/** Classify one path by extension: 'image' | 'doc' | null. Pure. */
const classifyPath = (filePath) => {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = filePath.slice(dot).toLowerCase();
  if (IMAGE_MIME[ext]) return 'image';
  if (ext === '.pdf') return null; // not text-extractable in this path — refused honestly
  return 'doc';
};

/** Mime label for an image path (null when unaccepted). Pure. */
const imageMimeOf = (filePath) =>
  IMAGE_MIME[filePath.slice(filePath.lastIndexOf('.')).toLowerCase()] || null;

/**
 * Read one image file as a validated data URI. Throws with an honest reason.
 * impure (fs)
 */
const readImagePayload = async (filePath) => {
  const mime = imageMimeOf(filePath);
  if (!mime) throw new Error(`${filePath}: not an accepted image type (png/jpg/webp/gif)`);
  const body = (await readFile(filePath)).toString('base64');
  const dataUri = `data:image/${mime};base64,${body}`;
  const check = sanitizeImageDataUri(dataUri);
  if (!check.ok) throw new Error(`${filePath}: ${check.reason}`);
  return dataUri;
};

/**
 * Read one text document as a validated {name, text}. Throws with an honest
 * reason. impure (fs)
 */
const readDocPayload = async (filePath) => {
  const text = await readFile(filePath, 'utf8');
  const check = sanitizeTextDocs([{ name: filePath, text }]);
  if (!check.ok) throw new Error(`${filePath}: ${check.reason}`);
  return check.docs[0];
};

/**
 * Stage a batch of paths into the wallet-bound store and return the ids the
 * turn frame carries. All-or-nothing: any bad path fails the WHOLE batch
 * before anything is parked. impure (fs + memory store)
 * @param {string[]} paths
 * @param {string} walletAddress
 * @returns {Promise<{ ids: string[], images: number, docs: number }>}
 */
export const stageAttachments = async (paths, walletAddress) => {
  const imagePaths = [];
  const docPaths = [];
  for (const p of paths) {
    const kind = classifyPath(p);
    if (kind === 'image') imagePaths.push(p);
    else if (kind === 'doc') docPaths.push(p);
    else throw new Error(`${p}: unsupported attachment type (images: png/jpg/webp/gif; documents: text files)`);
  }
  if (imagePaths.length === 0 && docPaths.length === 0) {
    throw new Error('no attachments given');
  }
  const images = await Promise.all(imagePaths.map(readImagePayload));
  const docs = await Promise.all(docPaths.map(readDocPayload));
  const imageCheck = images.length > 0 ? sanitizeImages(images) : { ok: true, images: [] };
  if (!imageCheck.ok) throw new Error(imageCheck.reason);
  const docCheck = docs.length > 0 ? sanitizeTextDocs(docs) : { ok: true, docs: [] };
  if (!docCheck.ok) throw new Error(docCheck.reason);
  const payloads = [
    ...imageCheck.images,
    ...docCheck.docs.map((d) => ({ kind: 'text', name: d.name, text: d.text })),
  ];
  const parked = attachmentStore.put(walletAddress, payloads);
  if (!parked.ok) throw new Error(parked.reason);
  return { ids: parked.ids, images: images.length, docs: docs.length };
};
