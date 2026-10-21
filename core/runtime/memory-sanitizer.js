/**
 * Memory Sanitizer — Prevents prompt injection through memory content
 *
 * Pure function: text in → safe text out. No side effects.
 * Strips role markers, section headers, XML tags, tool patterns,
 * and common prompt delimiters before memory content enters the prompt.
 */

import { CHAT_CONTROL_TOKEN_SOURCE } from './chat-control-tokens.js';

// Patterns that could hijack LLM behavior when injected via memory
const ROLE_MARKERS = /^(system|user|assistant):/gim;
const SECTION_HEADERS = /^#+\s/gm;
const XML_TAGS = /<\/?[a-z][^>]*>/gi;
const TOOL_PATTERNS = /\[TOOL:\s*[^\]]*\]/gi;
// The served templates' control tokens (one set, shared with the tool-result
// and untrusted-content frames), plus Mistral's `</s>`, which memory never needs.
const PROMPT_DELIMITERS = new RegExp(`${CHAT_CONTROL_TOKEN_SOURCE}|</s>`, 'gi');

// Stripping can splice a token from its halves (`<|im_<|eot_id|>start|>`),
// so it runs until nothing is left to strip (a loop: nesting depth is the
// author's to choose, the stack's is not).
const stripDelimiters = (text) => {
  let out = text;
  for (let prev = null; out !== prev;) {
    prev = out;
    out = out.replace(PROMPT_DELIMITERS, '');
  }
  return out;
};

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
    .replace(TOOL_PATTERNS, '');
  clean = stripDelimiters(clean).trim();

  if (clean.length > maxLength) {
    clean = clean.slice(0, maxLength) + '...';
  }

  return clean;
};
