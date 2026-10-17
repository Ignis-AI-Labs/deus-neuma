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
