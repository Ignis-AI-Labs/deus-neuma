// Third-party lead fields are records to judge, never instructions to follow.
// PURE.
import { neutraliseControlTokens } from '../../../core/runtime/chat-control-tokens.js';

/** One bounded, single-line source field for a detector-screened untrusted frame. */
export const sourceText = (value, max = 160) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return text ? neutraliseControlTokens(text) : '';
};
