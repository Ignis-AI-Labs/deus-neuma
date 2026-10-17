/**
 * mapview/hygiene — […]
 *
 * On 2026-07-26 two directories appeared at the top of this repo that had no
 * business being here: a `repos/` created by a being whose write ground was
 * pointed at the checkout instead of at its own house, and a video scaffold from
 * an unrelated session. Neither broke a test. Neither showed up in any
 * architecture finding — one was markdown, the other was a scaffold — so the
 * existing checks were all silent while the repo accumulated foreign material.
 *
 * The guard is deliberately an ALLOWLIST rather than a denylist of known junk:
 * contamination is by definition the thing nobody predicted, so the only durable
 * question is […] Adding a real
 * new directory costs one line of config; that friction is the point.
 *
 * Silent when no allowlist is configured — this must never fire on a repo that
 * has not opted in.
 *
 * All pure.
 */

/**
 * Top-level entries present but not agreed to.
 *
 * @param {string[]} rootEntries names directly under the repo root
 * @param {{ allow?: string[] }|null} rule the signed allowlist
 * @returns {string[]} sorted unexpected entries
 * Pure.
 */
export const findRootContamination = (rootEntries, rule) => {
  const allow = rule?.allow;
  if (!Array.isArray(allow) || !allow.length) return [];
  const permitted = new Set(allow);
  return rootEntries
    // A dotfile at the root is tooling convention (.git, .env, .vscode); policing
    // those would fire constantly on personal state that is nobody else's business.
    .filter((name) => !name.startsWith('.'))
    .filter((name) => !permitted.has(name))
    .sort();
};

/**
 * The line shown for an unexpected entry. It names both remedies, because the
 * honest answer is genuinely one of two things and the tool cannot know which.
 * Pure.
 */
export const contaminationAdvice = (name) => `\`${name}\` is not in the repo-root allowlist. `
  + `Either it does not belong in this repository — move it out, do not just gitignore it, `
  + `since ignoring hides the contamination rather than removing it — or it is a legitimate `
  + `new part of the tree, in which case add "${name}" to \`rootAllowlist.allow\` in mapview.config.json.`;

/**
 * Retired tool surface references (old direct state tools and observation tools).
 * These should be gone after S3b4/S3b5 — model now uses fs/* + intents + status/ files.
 * Pure. Expects entries like those from scan: { relFile, text }.
 */
export const findRetiredToolSurface = (fileEntries, retiredNames) => {
  const hits = [];
  const names = new Set(retiredNames || []);
  if (names.size === 0) return hits;

  for (const entry of fileEntries || []) {
    const rel = entry.relFile || entry;
    const text = entry.text || '';
    if (rel.includes('retired-tools') || rel.includes('.test.') || rel.includes('mapview')) continue;
    for (const n of names) {
      if (text.includes(n)) {
        hits.push({ file: rel, retired: n });
      }
    }
  }
  return hits;
};

/**
 * Size law / architectural bloat signals.
 * Pure.
 */
export const findSizeViolations = (fileSizes, baseline = {}) => {
  const violations = [];
  for (const [file, size] of Object.entries(fileSizes || {})) {
    const frozen = baseline[file];
    if (typeof frozen === 'number' && size > frozen) {
      violations.push({ file, size, frozen, kind: 'size-law-growth' });
    }
    if (size > 5000) {
      violations.push({ file, size, kind: 'bloat-monolith' });
    }
  }
  return violations;
};
