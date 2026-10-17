/**
 * Separate a qualification of consent from an independent refusal.
 * The caller must hold qualified language for clarification, never grant it.
 * @param {string} normalized - Lowercase text with collapsed whitespace.
 * @returns {{qualified: boolean, refusalText: string}}
 */
export const qualifiedConsentRefusal = (normalized) => {
  const refusalText = normalized.replace(/\b(?:do not|don't) consent as (?:if|though)\b/g, ' ');
  return Object.freeze({ qualified: refusalText !== normalized, refusalText });
};
