// user-projects.js — the witness's projects, over REST.
//
// impure — a project is a named working context (folder + terminal cwd +
// pinned chats). Every call carries the session bearer token; the backend
// keys everything to the wallet. Errors surface the server's message.

import { apiCall } from '../utils/http.js';

const BASE = '/api/v1/user/projects';

// impure — { projects, activeProjectId }
export const listProjects = async () => apiCall('GET', BASE);

// impure — { project }; channel defaults to 'house' unless a neumaId rides
export const createProject = async (name, folder, { channel, neumaId } = {}) =>
  apiCall('POST', BASE, { body: { name, folder, ...(channel ? { channel } : {}), ...(neumaId ? { neumaId } : {}) } });

// impure — { projects, activeProjectId }
export const deleteProject = async (id) => apiCall('DELETE', `${BASE}/${id}`);

// impure — { activeProjectId, project }
export const activateProject = async (id) => apiCall('POST', `${BASE}/${id}/activate`, { body: {} });

// impure — { project }
export const pinChat = async (id, chat) => apiCall('POST', `${BASE}/${id}/chats`, { body: chat });

// impure — { project }
export const unpinChat = async (id, sessionId, neumaId) => apiCall('DELETE', `${BASE}/${id}/chats`, { body: { sessionId, neumaId } });

// impure — add a file (inside the project folder) to the shared context → { project }
export const addSharedFile = async (id, filePath) => apiCall('POST', `${BASE}/${id}/files`, { body: { path: filePath } });

// impure — remove a file from the shared context → { project }
export const removeSharedFile = async (id, filePath) => apiCall('DELETE', `${BASE}/${id}/files`, { body: { path: filePath } });

// impure — which project (if any) already owns this folder → { binding|null }.
// Drives the switch-vs-reconnect prompt before an attach.
export const resolveFolder = async (folderPath) =>
  apiCall('GET', `${BASE}/folders/resolve?path=${encodeURIComponent(folderPath)}`);

// impure — attach a folder (or repo) to a project → { project }
export const attachFolder = async (id, folderPath) => apiCall('POST', `${BASE}/${id}/folders`, { body: { path: folderPath } });

// impure — detach a folder from a project → { project }
export const detachFolder = async (id, folderPath) => apiCall('DELETE', `${BASE}/${id}/folders`, { body: { path: folderPath } });

// impure — set the working folder (must be attached) → { project }
export const setWorkingFolder = async (id, folderPath) => apiCall('POST', `${BASE}/${id}/cwd`, { body: { path: folderPath } });

// impure — move a folder here (the reconnect arm of the prompt) → { project }
export const reconnectFolder = async (id, folderPath) => apiCall('POST', `${BASE}/${id}/folders/reconnect`, { body: { path: folderPath } });
