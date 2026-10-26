// Pure construction: catalog agents inherit user session essentials, not backend state.
const BASE_KEYS = Object.freeze([
  'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
  'DISPLAY', 'WAYLAND_DISPLAY', 'TMPDIR', 'TEMP', 'TMP',
]);
const WINDOWS_KEYS = Object.freeze([
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
]);

/** Remove npm toolchain directories without discarding the operator's own PATH. */
export const agentTerminalPath = (value, platform) => String(value || '')
  .split(platform === 'win32' ? ';' : ':')
  .filter((entry) => {
    const normalized = entry.replace(/^"|"$/g, '').replace(/\\/g, '/').replace(/\/+$/, '');
    const candidate = platform === 'win32' ? normalized.toLowerCase() : normalized;
    return entry.length > 0 && !/(^|\/)node_modules\/\.bin$/.test(candidate);
  }).join(platform === 'win32' ? ';' : ':');

/** Construct an agent-only environment; the input is never mutated. */
export const agentTerminalEnvironment = (env, platform) => {
  const windows = platform === 'win32';
  const allowed = new Set(windows ? [...BASE_KEYS, ...WINDOWS_KEYS] : BASE_KEYS);
  const result = {};
  for (const [key, value] of Object.entries(env)) {
    if (allowed.has(windows ? key.toUpperCase() : key) && typeof value === 'string') result[key] = value;
  }
  const pathKey = windows ? Object.keys(env).find((key) => key.toUpperCase() === 'PATH') : 'PATH';
  result.PATH = agentTerminalPath(env[pathKey], platform);
  result.TERM = 'xterm-256color';
  return result;
};

// The backend's own secrets: what opens every being's files, what signs the
// operator's sessions, and the keys the backend loaded for itself. A process the
// backend starts for the operator inherits none of them.
export const BACKEND_SECRET_KEYS = Object.freeze([
  'AUTH_SECRET', 'DNA_ENCRYPTION_KEY', 'DNA_ENCRYPTION_KEY_PREVIOUS', 'DEPLOYER_PRIVATE_KEY',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'LLM_API_KEY', 'ELEVENLABS_API_KEY',
  'ETH_RPC_URL', 'BASE_MAINNET_RPC_URL',
]);

/** The operator's own environment minus the backend's secrets. Pure; the input is never mutated. */
export const withoutBackendSecrets = (env) => {
  const result = { ...env };
  for (const key of BACKEND_SECRET_KEYS) delete result[key];
  return result;
};

// A helper that fetches (npx, uv sync, a model download) needs the operator's
// proxy and trust settings; none of them is a backend secret.
const NETWORK_KEYS = Object.freeze(new Set([
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS',
]));

/**
 * The environment a helper process the platform spawns (an MCP server, a
 * voice sidecar, a sandboxed run) starts with: the agent essentials and the
 * network settings, plus the names the helper itself reads (`passes`) —
 * never the backend's own secrets (AUTH_SECRET, DNA_ENCRYPTION_KEY, provider
 * keys). Pure; the input is never mutated.
 * @param {Record<string, string|undefined>} env
 * @param {string} platform
 * @param {(key: string) => boolean} [passes]
 * @returns {Record<string, string>}
 */
export const helperEnvironment = (env, platform, passes = () => false) => {
  const result = agentTerminalEnvironment(env, platform);
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && (NETWORK_KEYS.has(key) || passes(key))) result[key] = value;
  }
  return result;
};
