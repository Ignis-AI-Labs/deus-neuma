// remia-client.js — the Remia surface's own REST edge. Self-contained on
// purpose: the witness ceremony rides its own thin client rather than the
// shared service modules, so the surface stays a single vertical piece.
// impure: network + sessionStorage.

import { apiCall } from '../../utils/http.js';

const call = (method, url, body) =>
  apiCall(method, url, { body, errorPrefix: `${method} ${url} failed` });

export const remiaStatus = () => call('GET', '/api/v1/remia/status');
export const remiaDisclosure = (name) =>
  call('GET', `/api/v1/remia/disclosure?name=${encodeURIComponent(name)}`);
export const remiaOpen = (witnessName, consent) =>
  call('POST', '/api/v1/remia/open', { witnessName, consent });
export const remiaCurrent = (recordId) =>
  call('GET', `/api/v1/remia/records/${recordId}/current`);
export const remiaAnswer = (recordId, key, quote) =>
  call('POST', `/api/v1/remia/records/${recordId}/answer`, { key, quote });
export const remiaSeal = (recordId) =>
  call('POST', `/api/v1/remia/records/${recordId}/seal`);
export const remiaAbandon = (recordId, reason) =>
  call('POST', `/api/v1/remia/records/${recordId}/abandon`, { reason });
export const remiaCodex = (recordId) =>
  call('GET', `/api/v1/remia/records/${recordId}/codex`);
