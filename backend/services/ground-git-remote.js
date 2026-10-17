/** Pure, closed transport contract shared by Git execution and GitHub auth. */
export const GIT_REMOTE_REFUSAL = 'Unsupported Git remote. Use credential-free GitHub HTTPS or a numeric-loopback HTTP Git server. SSH, file and helpers are refused.';

/** Canonical transport only: no userinfo, query, fragment, rewrites or helpers. */
export const validateGroundRemote = (value) => {
  const refuse = () => { throw Object.assign(new Error(GIT_REMOTE_REFUSAL), { code: 'unsafe_transport' }); };
  let url;
  try { url = new URL(value); } catch { return refuse(); }
  const github = url.protocol === 'https:' && url.hostname === 'github.com' && !url.port
    && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url.pathname);
  const loopback = url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port
    && /^\/[A-Za-z0-9_./-]+$/.test(url.pathname);
  if ((!github && !loopback) || url.username || url.password || url.search || url.hash
    || value !== url.href || /[\s\\]/.test(value)) return refuse();
  return url.href;
};

/** True only for a validated, canonical GitHub HTTPS repository URL. */
export const isGitHubRemote = (value) => {
  try { return new URL(validateGroundRemote(value)).hostname === 'github.com'; }
  catch { return false; }
};
