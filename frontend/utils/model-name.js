// model-name — the readable name of a served model, wherever it came from.
//
// llama-server's wire id is the gguf's FULL filesystem path; catalog ids
// carry publisher/repo prefixes; cloud ids are already clean. A surface
// naming a conduit shows the MODEL, not the operator's disk layout
// ("CONDUIT /home/…/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf" witnessed 2026-07-20).
// Pure.

const SHARD_SUFFIX = /-\d{5}-of-\d{5}$/;

// A served id can be a kernel descriptor path (/proc/self/fd/4) when the
// backend has not mapped the identity yet — its basename ("4") is not a name.
const FD_PATH = /^(?:\/proc\/(?:self|\d+)|\/dev)\/fd\/\d+$/;

/**
 * "…/Qwen3.6-35B-A3B-UD-Q4_K_M-00001-of-00002.gguf" → "Qwen3.6-35B-A3B-UD-Q4_K_M"
 * "openai/gpt-oss-120b" → "gpt-oss-120b" · null/'' → '—'
 * @param {string|null|undefined} modelId
 * @returns {string}
 */
export const displayModelName = (modelId) => {
  const raw = String(modelId ?? '').trim();
  if (!raw || FD_PATH.test(raw)) return '—';
  const base = raw.split('/').filter(Boolean).pop() ?? raw;
  return base.replace(/\.gguf$/i, '').replace(SHARD_SUFFIX, '') || '—';
};
