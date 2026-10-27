// changelog-rules — THE CHANGELOG TRAVELS WITH THE CHANGE (ruling, 2026-10-23): a commit that
// changes what a person sees or does says so in plain words in the same commit, so every release
// can say what changed. Pure; the commit-msg hook (changelog-gate.mjs) and the release flow's
// changelog fold are its two callers.
//
// A line is written as a FRAGMENT, one file per change, so parallel work never edits one shared
// file (a pathspec commit of CHANGELOG.md would sweep another session's half-written line):
//
//   changelog.d/<slug>.md      first line: Added | Changed | Fixed | Removed | Security
//                              then the bullet lines, plain words, no internal names
//
// Editing CHANGELOG.md's [Unreleased] section directly also counts.

export const SECTIONS = Object.freeze(['Added', 'Changed', 'Fixed', 'Removed', 'Security']);
export const FRAGMENT_DIR = 'changelog.d';

// What a person runs: product code, not its tests.
const PRODUCT = /^(frontend|backend|electron|core|cli|bin)\//;
const NOT_PRODUCT = /(^|\/)test\/|\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/;
const USER_FACING = /^(feat|fix|perf)(\(([^)]*)\))?!?:/;
const INTERNAL_SCOPE = /^(test|tests|work|docs|ci|lint|deps-dev)$/;
const NONE = /^Changelog:\s*none\b/im;

/**
 * Does this commit owe a changelog line, and does it carry one?
 * @param {{message: string, staged: string[]}} commit
 * @returns {{ok: true} | {ok: false, why: string}}
 */
export const changelogVerdict = ({ message, staged }) => {
  const subject = String(message).split('\n')[0];
  const kind = subject.match(USER_FACING);
  if (!kind || INTERNAL_SCOPE.test(kind[3] || '')) return { ok: true };
  if (!staged.some((f) => PRODUCT.test(f) && !NOT_PRODUCT.test(f))) return { ok: true };
  if (staged.some((f) => f === 'CHANGELOG.md' || (f.startsWith(`${FRAGMENT_DIR}/`) && f.endsWith('.md')))) return { ok: true };
  if (NONE.test(message)) return { ok: true };
  return {
    ok: false,
    why: [
      'this commit changes the product but carries no changelog line.',
      `  add ${FRAGMENT_DIR}/<slug>.md to the commit — first line Added, Changed, Fixed, Removed or Security,`,
      '  then "- " lines in plain words saying what changed for the person using it;',
      '  or, when nothing a person sees or does changed, end the message with the line',
      '  "Changelog: none — <why>".',
    ].join('\n'),
  };
};

/**
 * Parse one fragment's text.
 * @returns {{section: string, lines: string[]} | {error: string}}
 */
export const parseFragment = (text) => {
  const rows = String(text).replace(/\r/g, '').split('\n');
  const section = (rows[0] || '').replace(/^#+\s*/, '').trim();
  if (!SECTIONS.includes(section)) return { error: `the first line must be one of ${SECTIONS.join(', ')} (it is "${section}")` };
  const body = rows.slice(1).join('\n').trim();
  if (!body.startsWith('- ')) return { error: 'the lines after the section start with "- "' };
  return { section, lines: body.split(/\n(?=- )/).map((l) => l.trimEnd()) };
};

/** The bullet groups of a changelog section's body ("### Added" … ), in SECTIONS order. */
export const parseSectionBody = (body) => {
  const groups = Object.fromEntries(SECTIONS.map((s) => [s, []]));
  let current = null;
  const prose = [];
  for (const chunk of String(body).split(/\n(?=### |- )/)) {
    const head = chunk.match(/^### (\w+)/);
    if (head) { current = SECTIONS.includes(head[1]) ? head[1] : null; continue; }
    if (current && chunk.startsWith('- ')) groups[current].push(chunk.trimEnd());
    else if (!current && chunk.trim()) prose.push(chunk.trim());
  }
  return { groups, prose };
};

/** A changelog section body from bullet groups (empty groups left out). */
export const renderGroups = (groups) => SECTIONS
  .filter((s) => groups[s] && groups[s].length)
  .map((s) => `### ${s}\n\n${groups[s].join('\n')}`)
  .join('\n\n');
