// Recovery codes — ONE surface, three callers.
//
// Design note, 2026-07-29: […]
//
// He was right, and the duplication was not harmless. Three copies existed:
//   • BirthCeremony.js   — copy + download + saved-check + gated continue
//   • BirthSetupGate.jsx — its own download, its own text
//   • WitnessSummonCeremony.jsx — a list and a checkbox, NO copy, NO download
//
// The third is what the drift costs. A witness's codes are shown once and only
// their hashes persist, so the operator's only route out of that screen was to
// hand-transcribe eight 16-character codes. The copy that mattered most was the
// copy that got the least.
//
// Everything here is DOM-free except the two calls that must touch the DOM, and
// those touch it only when invoked — so the pure builders stay importable and
// testable outside a browser.

/**
 * The codes as a numbered list — the exact text that goes on the clipboard.
 * @param {string[]} codes
 * @returns {string}
 */
export const numberedCodes = (codes) =>
  (codes || []).map((code, i) => `${i + 1}. ${code}`).join('\n');

/**
 * The full saved document. The closing paragraph states the limit rather than
 * implying it: nothing can reprint these, so a person deciding whether this
 * file matters should not have to infer that it does.
 * @param {{codes: string[], subject?: string, savedAt?: string}} params
 * @returns {string}
 */
export const recoveryCodesDocument = ({ codes, subject, savedAt }) => [
  `Neuma Recovery Codes${subject ? ` — ${subject}` : ''}`,
  `Generated: ${savedAt || new Date().toISOString()}`,
  '',
  numberedCodes(codes),
  '',
  'These codes are the second door to this keypair. The first is the password',
  'you chose. Only their hashes were kept — nothing can reprint them. If the',
  'password is lost and this file is gone, the key cannot be opened again.',
  '',
].join('\n');

/**
 * A filename that cannot escape the download directory or carry a separator.
 * Lane ids look like `witness:openai:Pezugar`, so this is not hypothetical.
 * @param {string} [id]
 * @returns {string}
 */
export const recoveryFileName = (id) => {
  const safe = String(id || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')   // no separator survives — no traversal
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');      // and no leading dots to hide the file
  return `neuma-recovery-${safe || 'keypair'}.txt`;
};

/**
 * impure — put the codes on the clipboard. Never throws: a denied clipboard
 * permission is an ordinary outcome the caller shows, not an unhandled
 * rejection (which is what the birth ceremony's bare `writeText` produced).
 * @param {string[]} codes
 * @returns {Promise<boolean>} whether the write landed
 */
export const copyRecoveryCodes = async (codes) => {
  try {
    await navigator.clipboard.writeText(numberedCodes(codes));
    return true;
  } catch {
    return false;
  }
};

/**
 * impure — write the codes to a file the operator keeps. Never throws, for the
 * same reason as above: the codes are still on screen, and a failed download
 * must not take the screen down with it.
 * @param {{codes: string[], subject?: string, id?: string, savedAt?: string}} params
 * @returns {boolean} whether the download was handed to the browser
 */
export const downloadRecoveryCodes = ({ codes, subject, id, savedAt }) => {
  try {
    const blob = new Blob([recoveryCodesDocument({ codes, subject, savedAt })], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = recoveryFileName(id || subject);
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
};
