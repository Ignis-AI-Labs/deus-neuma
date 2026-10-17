// team-delivery.js — the DELIVERY lane: when a team finishes, what landed in
// the workspace is packaged for the witness to open FROM THE STREAM — browse
// the files, view an image, run an .html, read the code — no folder-hunting
// (Founder's delivery law, 2026-07-15: […]).
//
// A delivery manifest is a WITNESS-layer fact (the workspace root and file
// names already crossed the witness's wire in the plan card and the run) —
// one file per run id, owner-scoped by wallet like team-run-store. The
// manifest is the AUTHORITY for later file reads: a read serves only a file
// inside the recorded root, re-checked through realpath so a symlink planted
// in the workspace cannot walk out of it.
//
// Shared primitive (uniform-architecture law): the portal team_run lane
// snapshots here; the delivery routes read here; any future lane (SSE runs,
// trials) packages deliverables the same way.
//
// Test isolation: NEUMA_TEAM_DELIVERY_PATH overrides the dir, resolved per
// call — RULE-0 real-disk tests never touch live delivery history.

import fs from 'fs/promises';
import path, { join } from 'path';
import { getDataRoot } from './data-root.js';

const deliveryDir = () => process.env.NEUMA_TEAM_DELIVERY_PATH || join(getDataRoot(), 'team-deliveries');

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// A delivery is what the team WROTE, not the machinery around it.
const SKIP_DIRS = new Set(['__pycache__', 'node_modules', '.git']);
const MAX_FILES = 200; // a workspace beyond this is a report problem, not a browse problem
const MAX_READ_BYTES = 4 * 1024 * 1024; // viewer cap — bigger files open in FILES

// pure — does this wallet own this record? (team-run-store's rule.)
const ownedBy = (record, wallet) =>
  typeof record?.by === 'string' && typeof wallet === 'string' && wallet.length > 0 &&
  record.by.toLowerCase() === wallet.toLowerCase();

// pure — how the viewer should render a file, by extension.
export const deliverableKind = (file) => {
  const ext = path.extname(String(file)).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return 'image';
  if (ext === '.svg') return 'svg';
  if (ext === '.html' || ext === '.htm') return 'html';
  return 'text';
};

// impure — walk the workspace for the files the team delivered, relative to
// root, capped and honest about the cap.
const walkDeliverables = async (root) => {
  const files = [];
  let truncated = false;
  const walk = async (dir, rel) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // an unreadable corner is absence, not a crash
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(join(dir, e.name), relPath);
      } else if (e.isFile()) {
        const stat = await fs.stat(join(dir, e.name)).catch(() => null);
        if (stat) files.push({ file: relPath, bytes: stat.size, kind: deliverableKind(e.name) });
      }
    }
  };
  await walk(root, '');
  return { files, truncated };
};

/**
 * Register a finished run's workspace as its delivery — the manifest lands
 * atomically and becomes the authority (owner + root) for reads. The FILE
 * LIST is never frozen here: the LEAD keeps writing after the run settles
 * (assembly, QA fixes, the executed proof), so listings walk the root LIVE
 * at read time. impure.
 * @param {{id: string, by: string, root: string}} p
 * @returns {Promise<{id: string, root: string}|null>}
 */
export const snapshotDelivery = async ({ id, by, root }) => {
  if (!id || !ID_PATTERN.test(id) || typeof by !== 'string' || !by || typeof root !== 'string' || !root) return null;
  const record = { id, by, root, at: new Date().toISOString() };
  const dir = deliveryDir();
  await fs.mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${id}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(record, null, 2));
  await fs.rename(tmp, join(dir, `${id}.json`));
  return { id, root };
};

// impure — the raw manifest, owner-scoped; someone else's answers null
// (absent, never forbidden-but-real).
const readManifest = async (id, wallet) => {
  if (!id || !ID_PATTERN.test(id)) return null;
  let record;
  try {
    record = JSON.parse(await fs.readFile(join(deliveryDir(), `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
  return ownedBy(record, wallet) ? record : null;
};

/**
 * One wallet's delivery, with the workspace walked LIVE — what is there NOW
 * is what the witness opens. impure.
 * @returns {Promise<{id: string, root: string, files: Array, truncated: boolean}|null>}
 */
export const readDelivery = async (id, wallet) => {
  const record = await readManifest(id, wallet);
  if (!record) return null;
  const { files, truncated } = await walkDeliverables(record.root);
  return { id: record.id, root: record.root, files, truncated };
};

/**
 * One delivered file, for the stream's viewer — served as DATA (text or
 * base64), never as a navigable document, so model-written HTML/SVG only ever
 * runs inside the desk's sandboxed iframe. Containment: the path must resolve
 * inside the recorded root, re-checked through realpath. impure.
 * @returns {Promise<{ok: true, file: string, kind: string, bytes: number, text?: string, base64?: string}
 *   |{ok: false, error: string}>}
 */
export const readDeliveryFile = async (id, wallet, file) => {
  const record = await readManifest(id, wallet);
  if (!record) return { ok: false, error: 'no such delivery' };
  if (typeof file !== 'string' || !file) return { ok: false, error: 'name a file' };
  const root = path.resolve(record.root);
  const target = path.resolve(root, file);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return { ok: false, error: 'that path leaves the delivery workspace' };
  }
  let real;
  try {
    real = await fs.realpath(target);
  } catch {
    return { ok: false, error: 'that file is no longer there' };
  }
  const realRoot = await fs.realpath(root).catch(() => root);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    return { ok: false, error: 'that path leaves the delivery workspace' };
  }
  const stat = await fs.stat(real).catch(() => null);
  if (!stat?.isFile()) return { ok: false, error: 'that file is no longer there' };
  if (stat.size > MAX_READ_BYTES) return { ok: false, error: 'too large for the stream viewer — open it in FILES' };
  const kind = deliverableKind(file);
  const buf = await fs.readFile(real);
  return kind === 'image'
    ? { ok: true, file, kind, bytes: stat.size, base64: buf.toString('base64') }
    : { ok: true, file, kind, bytes: stat.size, text: buf.toString('utf8') };
};
