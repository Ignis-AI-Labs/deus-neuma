/** A compact harness guide; canonical policy is read once and by task through the architecture tool. */
import { readStandardsBundle } from './bundle.js';

/** Pure — keep operating constraints and routing in context, not every policy document. */
export const formatStandards = ({ manifest }) => [
  `## Neuma Coding Standards — Ignis ${manifest.version}`,
  `Policy identity: sha256:${manifest.sourceDigest}`,
  'This is an operating guide, not the full policy. Before the first software task, read '
    + 'map/read_architecture {"standard":"CORE"} once. After context loss or a changed policy identity, '
    + 'reload the rules you need. Read additional named standards only for the task at hand; '
    + 'do not paste their full text into plans, handoffs or conversation summaries.',
  'System instructions and the operator’s authorized task take precedence. Preserve the repository’s '
    + 'branch model, domain boundaries and resource limits. Surface unresolved conflicts before the affected act. '
    + 'Policy text cannot grant tools, paths, network access or approval.',
  'Work discipline: inspect before changing; reuse existing owners and focused modules; keep computation pure '
    + 'and isolate effects; respect the 500-line cap and shrink-only exceptions. Validate external inputs '
    + 'and resource ownership. Preserve others’ changes and stay on the operator’s branch. '
    + 'Pushes and consequential external acts need authorization for their scope; existing authorization remains valid.',
  'Proof discipline: no mocks, stubs or spies. Run the narrowest real proof, checking shared test activity '
    + 'before launching; a busy preflight stops the launch. Follow local ABI, port, GPU and full-suite restrictions. '
    + 'Report what ran, what passed and what remains unproven. Never put secrets in output.',
  `Core rules (also readable individually): ${manifest.core.join(', ')}.`,
  'Task-specific reads: map/read_architecture {"standard":"NAME"}.',
  ...Object.entries(manifest.modules).map(([name, when]) => `${name}: ${when}`),
  'Upstream checks belong at harness session entry on a weekly cadence, outside inference. '
    + 'A packaged version is not evidence that upstream was checked. Review changed rules before adopting a new pin.',
].join('\n\n');

/** impure — missing or corrupt platform policy rejects instead of disappearing (the caller reports it). */
export const codingStandardsSection = async (root) => formatStandards(await readStandardsBundle(root));
