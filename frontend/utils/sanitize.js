// Shared HTML sanitization — prevents XSS from user/LLM content

/**
 * Escape HTML special characters to prevent XSS injection.
 * Use this for ANY user-controlled or LLM-generated content
 * before inserting into innerHTML or template literals.
 * @param {*} str — value to escape
 * @returns {string} escaped string safe for HTML insertion
 */
export const escapeHTML = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};
