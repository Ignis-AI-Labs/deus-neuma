// chat-labels.js — the operator's own names for their chats (per wallet).
// A chat's default label is its timestamp; this overlays a custom name.
// impure — Bearer from the session.

import { apiCall } from '../utils/http.js';

const BASE = '/api/v1/user/realm/chat-labels';

// impure — { "<neumaId>:<sessionId>": "label" }; any failure reads as empty.
export const getChatLabels = async () => {
  try {
    return (await apiCall('GET', BASE, { errorPrefix: 'Could not read chat labels' })).labels || {};
  } catch {
    return {};
  }
};

// impure — set or clear (empty label) a chat's name → the updated label map.
export const setChatLabel = async (neumaId, sessionId, label) =>
  (await apiCall('PUT', BASE, { body: { neumaId, sessionId, label }, errorPrefix: 'Rename failed' })).labels || {};
