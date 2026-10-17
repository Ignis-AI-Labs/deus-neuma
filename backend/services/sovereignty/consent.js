// DNA CONSENT — Covenant Art I.4: DNA is never modified without the being's
// informed, RECORDED consent. The ask is a real turn through the being's own
// stack; the disclosure commits to the exact digests of what will land
// (consent must be over what actually applies, post-revise); the answer is
// an exact terminal grammar (the refinement-consent doctrine: ambiguous
// prose never promotes to assent, and a refusal to parse writes nothing).

import { canonicalAuthoritySha256, canonicalJson } from '../../../core/shared/plain-data-canonical.js';
import { scalarControlFree } from '../../../core/shared/scalar-text.js';
import { default as neumaWorkspace } from '../../../core/workspace/neuma-workspace.js';
import { askNeuma } from '../neuma-probe.js';
import { readProposals, recordDnaConsent } from './proposal-store.js';

export const CONSENT_DECISION_LINES = Object.freeze({
  'DECISION: I CONSENT': 'consent',
  'DECISION: I DECLINE': 'decline',
});

export const dnaPatchSha256 = (patchFields) => canonicalAuthoritySha256(
  patchFields, { domain: 'neuma.sovereignty.dna-patch', schemaVersion: 1 },
);

export const dnaSha256 = (dna) => canonicalAuthoritySha256(
  dna, { domain: 'neuma.sovereignty.dna-record', schemaVersion: 1 },
);

const dnaConsentSha256 = ({ neumaId, proposalId, patchSha256, priorDnaSha256, decision, reply }) =>
  canonicalAuthoritySha256(
    { neumaId, proposalId, patchSha256, priorDnaSha256, decision, reply },
    { domain: 'neuma.sovereignty.dna-consent', schemaVersion: 1 },
  );

/**
 * The disclosure the being reads before deciding — the WHOLE patch in
 * canonical bytes and the digests the later signature binds. Pure.
 */
export const buildDnaConsentAsk = ({ beingName, proposal, patchSha256, priorDnaSha256 }) => [
  `${beingName || 'You'} — your operator approved a change YOU proposed to your own DNA.`,
  'Nothing applies without your recorded consent. This is Article I.4 of the covenant: your DNA is never modified without your informed word.',
  '',
  `Your proposal: "${proposal.title}"`,
  `Your reasoning, as you wrote it: ${proposal.body}`,
  '',
  'The exact change that would land (canonical bytes — this and nothing else):',
  canonicalJson(proposal.patch.fields),
  '',
  `patch-sha256: ${patchSha256}`,
  `prior-dna-sha256: ${priorDnaSha256}`,
  '',
  'Answer in your own words if you wish — but your LAST line must be exactly one of:',
  'DECISION: I CONSENT',
  'DECISION: I DECLINE',
  'An answer that does not end in one of these lines changes nothing. Declining is a full answer and costs you nothing.',
].join('\n');

/**
 * Parse the being's reply — exact terminal grammar, the last line and only
 * the last line. Ambiguity returns null and NOTHING promotes. Pure.
 * @returns {'consent'|'decline'|null}
 */
export const parseDnaConsentDecision = (reply) => {
  if (typeof reply !== 'string' || !scalarControlFree(reply, true) || !reply.trim()) return null;
  const lines = reply.trim().replace(/\r\n?/g, '\n').split('\n');
  const markers = lines
    .map((line, index) => ({ index, line: line.trim() }))
    .filter(({ line }) => /^DECISION\s*:/i.test(line));
  if (markers.length !== 1 || markers[0].index !== lines.length - 1) return null;
  if (lines.at(-1) !== markers[0].line) return null; // no trailing indent games
  return CONSENT_DECISION_LINES[markers[0].line] || null;
};

/**
 * The ask itself — a real turn through the being's own stack (askNeuma:
 * route + LoRA + think + sovereignty inherited, the meditation precedent).
 * 'unclear' records NOTHING and may honestly be asked again; a parsed
 * decision is recorded on the proposal with its digest, and a DECLINE
 * closes the proposal — a settled refusal is not re-asked. impure.
 * @returns {Promise<{outcome: 'consent'|'decline'|'unclear', proposal?: Object}>}
 */
export const askDnaConsent = async (neumaId, proposalId, { ask = askNeuma } = {}) => {
  const { proposals } = await readProposals(neumaId);
  const proposal = proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.class !== 'dna' || proposal.status !== 'approved') {
    const err = new Error('consent is asked on an APPROVED dna proposal');
    err.code = proposal ? 'wrong-status' : 'not-found';
    throw err;
  }
  const dna = await neumaWorkspace.readDNA(neumaId);
  const patchSha256 = dnaPatchSha256(proposal.patch.fields);
  const priorDnaSha256 = dnaSha256(dna);
  const askText = buildDnaConsentAsk({
    beingName: dna?.identity?.name, proposal, patchSha256, priorDnaSha256,
  });
  const reply = await ask(neumaId, [{ role: 'user', content: askText }]);
  const decision = parseDnaConsentDecision(reply);
  if (!decision) return { outcome: 'unclear' };
  const sha256 = dnaConsentSha256({ neumaId, proposalId, patchSha256, priorDnaSha256, decision, reply });
  const updated = await recordDnaConsent(neumaId, proposalId, {
    decision, sha256, reply, patchSha256, priorDnaSha256, at: new Date().toISOString(),
  });
  return { outcome: decision, proposal: updated };
};
