// HTTP wrappers + pure formatters for the model-routing REST surface
// (/api/v1/routing + /api/v1/neuma/:id/route). The wrappers are thin impure
// fetch calls; the formatters + parseModelId are pure so the CLI's output and
// the "provider/model" parsing are unit-testable without a backend.

const API_V1 = '/api/v1';

// impure — one authenticated JSON request. On !ok it throws an Error carrying
// the numeric `status` so callers classify precisely (a message-substring match
// would misread a 500 whose body text merely contains "401").
const request = async (backend, token, method, path, body) => {
  const res = await fetch(`${backend}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${res.status} ${data.error || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
};

// ── Provider administration (operator-scoped) ──
export const listProviders = (backend, token) => request(backend, token, 'GET', `${API_V1}/routing/providers`);
export const listModels = (backend, token, providerId) => request(backend, token, 'GET', `${API_V1}/routing/providers/${providerId}/models`);
export const setProviderKey = (backend, token, providerId, patch) => request(backend, token, 'PUT', `${API_V1}/routing/providers/${providerId}/key`, patch);
export const removeProviderKey = (backend, token, providerId) => request(backend, token, 'DELETE', `${API_V1}/routing/providers/${providerId}/key`);
export const testProvider = (backend, token, providerId, body) => request(backend, token, 'POST', `${API_V1}/routing/providers/${providerId}/test`, body || {});

// ── Locked connections (the summon pool) ──
export const connectProvider = (backend, token, providerId, body) => request(backend, token, 'POST', `${API_V1}/routing/providers/${providerId}/connect`, body || {});
export const listConnections = (backend, token) => request(backend, token, 'GET', `${API_V1}/routing/connections`);
export const removeConnection = (backend, token, providerId) => request(backend, token, 'DELETE', `${API_V1}/routing/connections/${providerId}`);

// ── Per-neuma route override (ownership-gated) ──
export const getNeumaRoute = (backend, token, neumaId) => request(backend, token, 'GET', `${API_V1}/neuma/${neumaId}/route`);
export const setNeumaRoute = (backend, token, neumaId, route) => request(backend, token, 'PUT', `${API_V1}/neuma/${neumaId}/route`, route);
export const clearNeumaRoute = (backend, token, neumaId) => request(backend, token, 'DELETE', `${API_V1}/neuma/${neumaId}/route`);

/**
 * Parse a "provider/model" id. Provider is before the FIRST slash; the model is
 * the remainder (may itself contain slashes, e.g. openrouter/anthropic/claude).
 * Pure. Returns null when malformed.
 * @param {string} id
 * @returns {{provider: string, model: string}|null}
 */
export const parseModelId = (id) => {
  if (typeof id !== 'string') return null;
  const slash = id.indexOf('/');
  if (slash <= 0 || slash === id.length - 1) return null;
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) };
};

/** Render a route half as "provider/model" or a dash. Pure. */
const routeId = (r) => (r && r.provider && r.model ? `${r.provider}/${r.model}` : '-');

/**
 * Format the provider list for stdout. A leading '*' marks a configured
 * (routable) provider. Pure.
 * @param {Array<{id,kind,requiresKey,hasKey,endpoint}>} providers
 */
export const formatProviders = (providers) => {
  if (!providers || providers.length === 0) return '(no providers)\n';
  const rows = providers.map((p) => {
    const configured = p.hasKey || !p.requiresKey;
    const mark = configured ? '*' : ' ';
    const key = p.requiresKey ? (p.hasKey ? 'key set' : 'needs key') : 'keyless';
    return `${mark} ${p.id.padEnd(12)} ${p.kind.padEnd(6)} ${key.padEnd(10)} ${p.endpoint || ''}`.trimEnd();
  });
  return rows.join('\n') + '\n';
};

/** Format a model list for stdout — one "provider/model" per line. Pure. */
export const formatModels = (providerId, models) => {
  if (!models || models.length === 0) return '(no models)\n';
  return models.map((m) => `${providerId}/${m.id}`).join('\n') + '\n';
};

/**
 * Format a per-neuma route view (natal / override / effective). Pure.
 * @param {string} name - being display name
 * @param {{natal, override, effective}} view
 */
export const formatRouteView = (name, view) => {
  const eff = view.effective || {};
  const source = eff.source === 'override' ? '[override]'
    : eff.fellBack ? `[machine default, override dropped: ${eff.reason || 'unavailable'}]`
      : `[${eff.source || 'machine-default'}]`;
  return [
    `being: ${name}`,
    `  natal:     ${routeId(view.natal)} (birth history)`,
    `  override:  ${view.override ? routeId(view.override) : '(none - riding the machine default)'}`,
    `  effective: ${routeId(eff)} ${source}`,
    '',
  ].join('\n');
};
