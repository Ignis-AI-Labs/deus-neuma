// Threat remedy — how each finding is FIXED, said concretely enough that the
// CSO (or the operator it hands the fix to) can act without researching it.
//
// Design note, 2026-10-19: […] A finding that only
// names a danger leaves the office to rediscover the fix every time, so every
// finding carries a `remedy`. The probes that know the most set their own
// (advisory-scan: the fixed version; history-sweep + leak-liveness: which
// variable to rotate; house-probe: the file and its mode); this module holds
// the shared rotation wording and the remedy for the sources whose findings
// already carry everything a remedy needs (host listeners, the tracked-file
// sweep, the self-check walls, injection sightings). The ledger asks it only
// when a finding arrives without one.
//
// Pure throughout. A remedy never carries a secret value — it names the
// variable, the file and the provider, nothing more.

// Where each secret rule's credential is revoked. A wallet key has no
// revocation: the remedy is to move what it controls.
const PROVIDER = Object.freeze({
  'openai-key': 'OpenAI (platform.openai.com → API keys)',
  'anthropic-key': 'Anthropic (console.anthropic.com → API keys)',
  'xai-key': 'xAI (console.x.ai → API keys)',
  'github-token': 'GitHub (Settings → Developer settings → tokens)',
  'aws-access-key': 'AWS IAM (deactivate and delete the access key)',
  'slack-token': 'Slack (the app\'s OAuth & Permissions page)',
  'rpc-url-key': 'the RPC provider\'s dashboard (Alchemy / Infura / QuickNode)',
  'private-key-block': 'every system that trusts its public half (re-issue the keypair and remove the old public key)',
});

/**
 * pure — the rotation a leaked credential owes.
 * @param {string} patternId the secret-sweep rule that matched
 * @param {string} what the variable name(s), or a description of the value
 * @returns {string}
 */
export const rotationRemedy = (patternId, what) => (patternId === 'evm-private-key'
  ? `replace ${what}: a wallet key cannot be revoked, so move its funds and contract roles to a new key, then retire the old address`
  : `rotate ${what} at ${PROVIDER[patternId] || 'the provider that issued it'}, then confirm the old key is revoked`);

// pure — `host:listener:<scope>:<port>` → the port.
const portOf = (externalId) => String(externalId).split(':').pop();

// pure — a network listener: who owns it and how it closes.
const listenerRemedy = (finding) => {
  const port = portOf(finding.externalId);
  if (finding.owner) {
    return `${finding.owner} is NEUMA's own service: set its bind back to 127.0.0.1 and restart it; `
      + `if the wider bind is meant, add port ${port} to the watch list's expected ports (Settings → Security).`;
  }
  const who = finding.process
    ? `stop ${finding.process} or rebind it to 127.0.0.1`
    : `name the owner with \`sudo ss -ltnp 'sport = :${port}'\`, then stop it or rebind it to 127.0.0.1`;
  return `${who}; if it is meant to be reachable, add port ${port} to the watch list's expected ports (Settings → Security).`;
};

// The file that owns each self-check wall — where the regression is fixed.
const WALL_OWNER = Object.freeze({
  'platform-write-wall': 'backend/services/platform-write-walls.js (asked through sandbox-path-policy.js laneStateWriteReason)',
  'ssrf-private-ranges': 'backend/services/endpoint-guard.js (isPrivateHost)',
  'helper-env-secrets': 'backend/services/agent-terminal-environment.js, image-forge/comfyui-supervisor.js and doc-press/chromium-press.js (the helper environment builders)',
  'auto-hard-gates': 'backend/services/protocol-guard.js (the AUTO hard-gate list)',
  'machine-owner-gate': 'the route file of each listed route — requireInstallOwner (backend/services/install-owner.js) belongs in its handler chain',
});

// pure — a failed wall: which one, the probes it let through, and its file.
const selfCheckRemedy = (finding) => {
  const wall = String(finding.externalId).replace(/^self-check:/, '');
  const failed = (finding.surfaces || []).slice(0, 5).join(', ');
  return `the ${wall} wall failed${failed ? ` (let through: ${failed})` : ''}: fix it in ${WALL_OWNER[wall] || 'the module the self-check names'}, `
    + 'then run the scan again — the next whole self-check closes this when the wall holds.';
};

// pure — a sighting: what to read and what to cut.
const injectionRemedy = (finding) => {
  // `injection:<lane>:<source>:<day>` — a tool label may itself hold a colon.
  const parts = String(finding.externalId).split(':');
  const lane = parts[1] || 'the lane';
  const day = parts.length > 3 ? parts.at(-1) : '';
  const source = parts.slice(2, parts.length > 3 ? -1 : undefined).join(':') || 'its source';
  return `read the masked excerpt in the summary against ${source}; if ${source} is not a source this house trusts, cut it; `
    + `then check lane ${lane}'s journal${day ? ` for ${day}` : ''} for any act the being took after reading it.`;
};

// pure — a key shape in a tracked file: it is already in history.
const trackedSecretRemedy = (finding) => {
  // `sweep:<rule>:<file>:<fingerprint>` — a path may itself hold a colon.
  const parts = String(finding.externalId).split(':');
  const patternId = parts[1] || '';
  const file = parts.slice(2, -1).join(':') || 'the file';
  return `${rotationRemedy(patternId, `the ${patternId} credential in ${file}`)}; then replace the value in ${file} with a reference to its env variable — `
    + 'it is tracked, so deleting the line alone leaves it in git history.';
};

/**
 * pure — the remedy for a finding whose probe did not set one, or '' when
 * the source has no standing remedy (a manual entry says its own).
 * @param {Object} finding a validated threat shape
 * @returns {string}
 */
export const remedyFor = (finding) => {
  if (finding.source === 'host-probe') return listenerRemedy(finding);
  if (finding.source === 'self-check') return selfCheckRemedy(finding);
  if (finding.source === 'injection') return injectionRemedy(finding);
  if (finding.source === 'secret-sweep' && String(finding.externalId).startsWith('sweep:')) return trackedSecretRemedy(finding);
  return '';
};
