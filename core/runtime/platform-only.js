/**
 * THE PLATFORM, WITH NO IDENTITY — the HARNESS arm's prompt.
 *
 * Design note, 2026-09-29: […]
 *
 * So the HARNESS arm sits a real agent turn — the same loop, tools, sandbox,
 * thought governor and platform rules a being has — with every identity layer
 * off. It is an ALLOWLIST, not a denylist: only sections that belong to the
 * platform ride, so a new identity section added tomorrow can never leak into
 * a harness measurement by being forgotten here. The seat line names what is
 * answering without naming anyone, and the closing carries the answer
 * covenant (the platform's law) without the being's sovereignty line.
 *
 * Pure.
 */

import { ANSWER_COVENANT } from './answer-covenant.js';
import { CRAFT_METHOD_HOUSE, CRAFT_METHOD_PLATFORM } from './skills-section.js';

/** The sections that belong to the platform, not to a being. */
export const PLATFORM_SECTION_IDS = Object.freeze([
  'grounding', 'groundProtocol', 'tools', 'intents', 'skills', 'benchmark', 'present', 'closing',
]);

/** The one line that seats the platform — no name, no persona, no history. */
export const PLATFORM_SEAT_TEXT = 'You are an AI agent working through the Neuma platform. '
  + 'Use the tools and ground you are given to complete the task.';

// The platform states the craft method in its own words, exactly once — the
// WORKING STATE that may carry it for a being never rides here.
const platformMethod = (text) => {
  const body = String(text).replace(`\n\n${CRAFT_METHOD_HOUSE}`, '');
  return `${body}\n\n${CRAFT_METHOD_PLATFORM}`;
};

/**
 * pure — keep only the platform's sections, seat the platform first, and close
 * on the answer covenant alone.
 * @param {Array<{id: string, label: string, text: string}>} sections the assembled turn sections
 * @returns {Array<{id: string, label: string, text: string}>}
 */
export const platformOnlySections = (sections) => [
  Object.freeze({ id: 'platformSeat', label: 'PLATFORM', text: PLATFORM_SEAT_TEXT }),
  ...(sections ?? [])
    .filter((s) => PLATFORM_SECTION_IDS.includes(s.id))
    .map((s) => (s.id === 'closing' ? Object.freeze({ ...s, text: ANSWER_COVENANT })
      // the craft method in the platform's own words — no house, no one quoted
      : s.id === 'skills' ? Object.freeze({ ...s, text: platformMethod(s.text) })
        : s)),
];
