/**
 * Memory Sanitizer — Prevents prompt injection through memory content
 *
 * Pure function: text in → safe text out. No side effects.
 * Strips role markers, section headers, XML tags, tool patterns,
 * and common prompt delimiters before memory content enters the prompt.
 */

// Patterns that could hijack LLM behavior when injected via memory
const ROLE_MARKERS = /^(system|user|assistant):/gim;
const SECTION_HEADERS = /^#+\s/gm;
const XML_TAGS = /<\/?[a-z][^>]*>/gi;
const TOOL_PATTERNS = /\[TOOL:\s*[^\]]*\]/gi;
const PROMPT_DELIMITERS = /(\[INST\]|\[\/INST\]|<<SYS>>|<\/s>|<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>)/gi;

/**
 * Sanitize memory text before injection into the system prompt.
 * Strips patterns that could cause role confusion or tool execution.
 * @param {string} text - Raw memory text
 * @param {number} [maxLength=300] - Maximum output length
 * @returns {string} Sanitized, truncated text
 */
export const sanitizeMemoryForPrompt = (text, maxLength = 300) => {
  if (!text || typeof text !== 'string') return '';

  let clean = text
    .replace(ROLE_MARKERS, '')
    .replace(SECTION_HEADERS, '')
    .replace(XML_TAGS, '')
    .replace(TOOL_PATTERNS, '')
    .replace(PROMPT_DELIMITERS, '')
    .trim();

  if (clean.length > maxLength) {
    clean = clean.slice(0, maxLength) + '...';
  }

  return clean;
};
