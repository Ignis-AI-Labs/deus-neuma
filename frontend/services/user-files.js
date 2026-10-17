// user-files.js — the witness's own filesystem, over REST.
//
// impure — the explorer's client for browsing + editing the user's real disk
// inside the folders they've opened. Every path is re-validated server-side;
// this client just carries it. Errors surface the server message so the UI
// can show why a folder/open/save failed.

import { apiCall, authHeadersOrNull } from '../utils/http.js';

const BASE = '/api/v1/user/files';

// impure
export const getRoots = async () => (await apiCall('GET', `${BASE}/roots`)).roots;

// impure
export const openFolder = async (root) => (await apiCall('POST', `${BASE}/roots`, { body: { root } })).roots;

// impure
export const closeFolder = async (root) => (await apiCall('DELETE', `${BASE}/roots`, { body: { root } })).roots;

// impure
export const listDir = async (path) =>
  (await apiCall('GET', `${BASE}/list?path=${encodeURIComponent(path)}`)).entries;

// impure — { content, binary, size, truncated, mtimeMs }
export const readFile = async (path) =>
  apiCall('GET', `${BASE}/read?path=${encodeURIComponent(path)}`);

// impure — { size, mtime, mtimeMs }. With expectedMtimeMs the save is
// conditional: the server answers 409 code CONFLICT when disk has moved since
// the buffer was read, and writes nothing (#235).
export const writeFile = async (path, content, expectedMtimeMs) =>
  apiCall('PUT', `${BASE}/write`, { body: { path, content, ...(expectedMtimeMs != null && { expectedMtimeMs }) } });

// impure — create a new file or folder → { path, type }
export const createEntry = async (path, kind) => apiCall('POST', `${BASE}/create`, { body: { path, kind } });

// impure — rename/move → { path, type }
export const renamePath = async (from, to) => apiCall('POST', `${BASE}/rename`, { body: { from, to } });

// impure — delete a file or folder → { deleted }
export const deletePath = async (path) => apiCall('DELETE', `${BASE}/entry`, { body: { path } });

// impure — navigate the disk to choose a folder (or a file, with
// includeFiles) → { path, parent, home, entries: [{name, path, hidden, dir}] }
export const browseDir = async (path, { includeFiles = false } = {}) => {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (includeFiles) params.set('files', '1');
  const q = params.toString();
  return apiCall('GET', `${BASE}/browse${q ? `?${q}` : ''}`);
};

// impure — create a folder inside a browsed directory (the picker's NEW
// FOLDER); returns the created absolute path.
export const createBrowseFolder = async (parent, name) =>
  (await apiCall('POST', `${BASE}/browse/mkdir`, { body: { parent, name }, errorPrefix: 'Could not create the folder' })).path;

// impure — the witness's recently-opened folders (newest first) → string[]
export const listRecents = async () =>
  (await apiCall('GET', `${BASE}/recents`)).recents;

// impure — the witness's mounted drives → [{ path, label }]
export const listDrives = async () =>
  (await apiCall('GET', `${BASE}/drives`)).drives;

// THE TWO-WAY BRIDGE (Design note, 2026-07-28 — the OS ⇄ Explorer drag.

/**
 * Land one OS-dropped file inside an open folder (impure). The body IS the
 * file (no multipart); the server sanitizes the name, suffixes collisions
 * (never a clobber), and answers where it actually landed.
 * @param {string} dirPath absolute directory inside an open root
 * @param {File} file the dropped file
 * @returns {Promise<{path: string, name: string, renamed: boolean, size: number}>}
 */
export const uploadFile = async (dirPath, file) => {
  const headers = authHeadersOrNull();
  if (!headers) throw new Error('Not authenticated.');
  const q = new URLSearchParams({ path: dirPath, name: file.name });
  const res = await fetch(`${BASE}/upload?${q}`, { method: 'POST', headers, body: file });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parsed?.error || `Upload failed (${res.status}).`);
  return parsed;
};

/**
 * The authenticated raw-bytes URL for one file (pure given the token) — the
 * browser drag-out's DownloadURL target; the token rides the query because
 * a native download cannot carry the header (the portal's own law).
 */
export const rawFileUrl = (path) => {
  const token = sessionStorage.getItem('authToken') || '';
  return `${BASE}/raw?path=${encodeURIComponent(path)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
};

/**
 * One file's bytes, for in-app binary READERS (the PDF viewer). Header-auth
 * — the token never rides a URL it does not need to. impure.
 * @param {string} path absolute path inside an open root
 * @returns {Promise<ArrayBuffer>}
 */
export const readRawBytes = async (path) => {
  const headers = authHeadersOrNull();
  if (!headers) throw new Error('Not authenticated.');
  const res = await fetch(`${BASE}/raw?path=${encodeURIComponent(path)}`, { headers });
  if (!res.ok) {
    const parsed = await res.json().catch(() => ({}));
    throw new Error(parsed?.error || `Could not read the file (${res.status}).`);
  }
  return res.arrayBuffer();
};

// impure — the working-tree truth of an opened repo →
// { isRepo, branch, ahead, behind, files: { repoRelPath: 'C'|'A'|'M'|'D'|'U' } };
// the server answers 403 when the path escapes the opened roots.
export const gitStatus = async (path) =>
  apiCall('GET', `${BASE}/git-status?path=${encodeURIComponent(path)}`);

// impure — every named root's truth in ONE metered call →
// { statuses: { path: status | null } }; null = outside the roots or unreadable.
export const gitStatusMany = async (paths) =>
  apiCall('GET', `${BASE}/git-status-many?${paths.map((p) => `path=${encodeURIComponent(p)}`).join('&')}`);
