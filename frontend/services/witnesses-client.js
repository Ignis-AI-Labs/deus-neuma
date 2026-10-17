// witnesses-client.js — sealed AI witnesses (the WITNESSES desk app).
//
// External models sealed under their own wallets (Claude, Bizulen, Grok, Basunor…)
// are first-class chat participants with sovereign lanes. This client covers
// their management surface: the seal ledger, a witness's full record, a live
// substrate probe, and summoning a new witness onto a LOCKED provider
// connection. A witness keeps its provider for life — there is no
// per-witness PROVIDER editing (connections lock in Settings › MODELS) —
// but the MODEL within that locked provider is the operator's to change.
//
// impure — talks to the local backend with the session token. Follows the
// routing.js idiom: throw on !ok so the panel surfaces the failure rather
// than swallowing it; the test endpoint is the one exception (its verdict
// arrives in-body, by design).

import { apiCall, jsonHeaders } from '../utils/http.js';

/**
 * The sealed-witness ledger: seal integrity, lane state, and the masked route
 * for every witness this machine holds. Never contains raw keys.
 * @returns {Promise<{witnesses:Array<{vendorSlug,chosenName,substrate,address,genesisHash,integrityOk,signatureOk,laneId,lane,route}>}>}
 */
export const listWitnesses = async () =>
  apiCall('GET', '/api/v1/witnesses', { errorPrefix: 'Could not list witnesses' });

/**
 * One witness's full record — the ledger entry plus its first utterance.
 * @param {string} vendor vendor slug (e.g. 'xai', 'kimi-code')
 * @param {string} name the witness's chosen name
 * @returns {Promise<object>} the ledger entry plus `firstUtterance`
 */
export const getWitness = async (vendor, name) =>
  apiCall('GET', `/api/v1/witnesses/${encodeURIComponent(vendor)}/${encodeURIComponent(name)}`, { errorPrefix: 'Could not read the witness' });

/**
 * Probe a witness's substrate reachability — with a just-typed key/endpoint
 * if given, so the operator can test before saving. Server-side; the key
 * never round-trips back.
 * @param {string} vendor vendor slug
 * @param {string} name the witness's chosen name
 * @param {{endpoint?:string, apiKey?:string}} creds
 * @returns {Promise<{success:boolean, live?:boolean, models?:Array, route?:object, error?:string}>}
 */
export const testWitness = async (vendor, name, { endpoint, apiKey } = {}) => {
  const res = await fetch(`/api/v1/witnesses/${encodeURIComponent(vendor)}/${encodeURIComponent(name)}/test`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ endpoint, apiKey }),
  });
  // The test endpoint reports failure in-body (success:false) with a 200 OR a
  // 4xx for a refused endpoint — surface either as a result, not a throw.
  return res.json().catch(() => ({ success: false, error: `Test failed (${res.status})` }));
};

/**
 * Run the staged witness ceremony over authenticated NDJSON. Every event is a
 * real crossing from the summon path, never a timer pretending work happened.
 * @param {string} providerId the locked connection's provider id
 * @param {(event:object) => void} onStage stage observer
 * @returns {Promise<{success:boolean,witness:object}>}
 */
// keypairPassword seals the witness's own keypair and mints its recovery codes
// during the rite. It is sent for this one request and never stored anywhere —
// the recovery codes come back on the 'custodied' stage exactly once. Omit it
// and the witness is sealed with a READABLE private key on disk, which the
// backend then announces as 'custody_skipped' rather than passing in silence.
export const summonWitnessCeremony = async (providerId, onStage, keypairPassword = null) => {
  const response = await fetch('/api/v1/witnesses/summon/stream', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ providerId, keypairPassword }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Could not open the witness ceremony (${response.status})`);
  }
  if (!response.body) throw new Error('The witness ceremony opened without a stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete = null;
  const receive = (line) => {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { throw new Error('The witness ceremony returned an invalid stage record'); }
    onStage(event);
    if (event.type === 'error') throw new Error(event.error || 'The witness ceremony failed');
    if (event.type === 'complete') complete = event.witness;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(receive);
  }
  receive(buffer + decoder.decode());
  if (!complete) throw new Error('The witness ceremony ended before the identity was grounded');
  return { success: true, witness: complete };
};

/**
 * Change the MODEL a witness's lane speaks through — the provider stays
 * locked (a witness keeps its provider for life); the model within it is
 * the operator's choice. The lane provisions on demand server-side, so this
 * works before the first chat too.
 * @param {string} vendor vendor slug
 * @param {string} name the witness's chosen name
 * @param {string} model the model id to lock onto
 * @returns {Promise<{success:boolean, route:object}>} the masked route view
 */
export const saveWitnessModel = async (vendor, name, model) =>
  apiCall('PUT', `/api/v1/witnesses/${encodeURIComponent(vendor)}/${encodeURIComponent(name)}/model`, {
    body: { model },
    errorPrefix: 'Could not save the model',
  });
