// titling-client — the desk's side of a batch titling job (backend/routes/titling-routes.js).
// impure (network). A refusal keeps its message; a job already running comes back as the job.
import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

const headersOrThrow = () => {
  const headers = authHeaders();
  if (!headers) throw new Error('not signed in');
  return headers;
};

/** Start a batch: {kind:'chats', neumaIds, sessionIds?, force?} or {kind:'councils', councilIds?, force?}. */
export const startTitling = async (body) => {
  try {
    return (await apiCall('POST', '/api/v1/titling/jobs', { headers: headersOrThrow(), body })).job;
  } catch (err) {
    throw new Error(err.http ? err.message : 'could not reach the platform', { cause: err });
  }
};

/** The job as it stands now. */
export const titlingStatus = async (id) => (await apiCall('GET', `/api/v1/titling/jobs/${id}`, { headers: headersOrThrow() })).job;

/** Stop the job between chats; what it named stays. */
export const cancelTitling = async (id) => (await apiCall('DELETE', `/api/v1/titling/jobs/${id}`, { headers: headersOrThrow() })).job;
