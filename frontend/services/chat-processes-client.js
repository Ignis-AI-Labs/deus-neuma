// chat-processes-client — what the chats left running (backend services/chat-processes.js), read and stopped.
import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

/** Every process one of the operator's chats started that still runs: {supported, groups}. */
export const listChatProcesses = () => apiCall('GET', '/api/v1/workspace/_processes', { headers: authHeaders(), errorPrefix: 'Could not list the running processes' });

/** Stop one process group a chat started (asked to end, then made to). */
export const stopChatProcess = (pgid) => apiCall('POST', `/api/v1/workspace/_processes/${encodeURIComponent(pgid)}/stop`, { headers: authHeaders(), errorPrefix: 'Could not stop it' });
