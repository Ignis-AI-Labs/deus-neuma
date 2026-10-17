// harness-route-line.js — the harness's SERVER, as the composer bar names it. Pure.
import { serverName } from '../FirstRunChoice/local-servers.js';

// host:port for a local server; the host alone for a cloud one
const placeOf = (endpoint) => {
  try {
    const url = new URL(endpoint);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return '';
  }
};

/** The option value for one server: provider and address — two LM Studios are two servers. */
export const serverKey = (server) => `${server?.providerId || ''}|${server?.endpoint || ''}`;

/**
 * "llama.cpp · localhost:8089", […], "OpenAI".
 * @param {{providerId?: string|null, name?: string|null, endpoint?: string|null, kind?: string|null}|null} server
 * @returns {string}
 */
export const serverLine = (server) => {
  if (!server?.providerId) return 'NO SERVER';
  const name = serverName(server.providerId) || server.name || server.providerId;
  const place = server.kind === 'cloud' ? '' : placeOf(server.endpoint);
  return [name, place].filter(Boolean).join(' · ');
};
