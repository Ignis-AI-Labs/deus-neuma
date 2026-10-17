// attunement-client.js — the being-attunement surface's own REST edge over
// /api/v1/attunement (plus the roster read the picker needs). Self-contained
// like remia-client: the ceremony rides its own thin vertical client.
// HTTP refusals carry `code` (the service's honest refusal) and `http` (the
// status) so the host can tell a real refusal from a dropped connection —
// the server survives a client drop mid-open/mid-ask, so a network error
// means "poll the truth", never "the ceremony failed".
// impure: network + sessionStorage.

import { apiCall } from '../../utils/http.js';

const call = (method, url, body) =>
  apiCall(method, url, { body, errorPrefix: `${method} ${url} failed` });

export const attRoster = () => call('GET', '/api/v1/roster');
export const attStatus = (neumaId) => call('GET', `/api/v1/attunement/${neumaId}/status`);
export const attOffer = (neumaId, trigger) =>
  call('POST', `/api/v1/attunement/${neumaId}/records`, { trigger });
export const attConsentAsk = (neumaId, recordId) =>
  call('POST', `/api/v1/attunement/${neumaId}/records/${recordId}/consent-ask`);
export const attOpen = (neumaId, recordId, consent) =>
  call('POST', `/api/v1/attunement/${neumaId}/records/${recordId}/open`, { consent });
export const attPostpone = (neumaId, recordId, quote, sessionId) =>
  call('POST', `/api/v1/attunement/${neumaId}/records/${recordId}/postpone`, { quote, sessionId });
export const attAsk = (neumaId, recordId) =>
  call('POST', `/api/v1/attunement/${neumaId}/records/${recordId}/ask`);
export const attReopen = (neumaId, recordId, key, reason) =>
  call('POST', `/api/v1/attunement/${neumaId}/records/${recordId}/reopen`, { key, reason });
export const attReview = (neumaId, recordId) =>
  call('GET', `/api/v1/attunement/${neumaId}/records/${recordId}/review`);
export const attReopenFlagged = (neumaId, recordId, reason, keys) =>
  call('POST', `/api/v1/attunement/${neumaId}/records/${recordId}/reopen-flagged`,
    keys ? { keys, reason } : { reason });
export const attSeal = (neumaId, recordId) =>
  call('POST', `/api/v1/attunement/${neumaId}/records/${recordId}/seal`);
export const attAbandon = (neumaId, recordId, reason) =>
  call('POST', `/api/v1/attunement/${neumaId}/records/${recordId}/abandon`, { reason });
