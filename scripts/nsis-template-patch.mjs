/**
 * NSIS TEMPLATE PATCH — the pure half (the CLI is patch-nsis-template.mjs).
 *
 * WHY (2026-10-24): electron-builder's installer template (templates/nsis/multiUser.nsh) finds the
 * default per-user install folder with
 *     System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'
 * which copies 1,024 wide characters (2 KB) out of the short string SHGetKnownFolderPath returned.
 * Whether that read runs off the end of the allocation depends on where the heap happens to put it,
 * so a fresh install crashed in System.dll (0xC0000005) on some launches and not others: 6 of 8
 * fresh silent installs crashed on the Windows 11 laptop this was found on, 0 of 14 once the read
 * was replaced. lstrcpyW copies the string and stops at its end.
 */

export const OVER_READ = "System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'";
export const SAFE_READ = "System::Call 'kernel32::lstrcpyW(w .r1, p r2)'";
// electron-builder 26 fixed the over-read itself: a bounded copy that stops at the string's end
export const UPSTREAM_READ = "System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p'";

/**
 * The template text with the over-read replaced. Pure.
 * @param {string} text multiUser.nsh as shipped
 * @returns {Readonly<{state: 'patched'|'already'|'upstream'|'absent', text: string}>}
 *   upstream: electron-builder's own bounded copy (26+), safe as shipped
 *   absent: none of the known forms is there (electron-builder changed the code; look at it by hand)
 */
export const patchMultiUser = (text) => {
  if (text.includes(OVER_READ)) return Object.freeze({ state: 'patched', text: text.split(OVER_READ).join(SAFE_READ) });
  if (text.includes(SAFE_READ)) return Object.freeze({ state: 'already', text });
  if (text.includes(UPSTREAM_READ)) return Object.freeze({ state: 'upstream', text });
  return Object.freeze({ state: 'absent', text });
};
