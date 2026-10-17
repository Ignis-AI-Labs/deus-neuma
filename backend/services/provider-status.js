// provider-status.js — the provider's own status page, one hop from a
// disruption notice.
//
// When a third-party route fails mid-turn (overloaded, outage, quota), the
// witness stares at a dead-end error. Every URL here was verified LIVE
// (2026-07-28) — a guessed status link is worse than none, so providers
// without a verified page resolve to null and the notice simply carries no
// link. Pure.
//
//   openai / openai-chatgpt   https://status.openai.com       (200)
//   anthropic (+ claude-code) https://status.anthropic.com    (200)
//   xai                       https://status.x.ai             (403 to bots — real)
//   kimi-for-coding           https://status.moonshot.cn      (200; .ai TLD is dead)
//   github-copilot            https://www.githubstatus.com    (200)

const STATUS_PAGES = Object.freeze({
  openai: 'https://status.openai.com',
  'openai-chatgpt': 'https://status.openai.com',
  anthropic: 'https://status.anthropic.com',
  xai: 'https://status.x.ai',
  'kimi-for-coding': 'https://status.moonshot.cn',
  'github-copilot': 'https://www.githubstatus.com',
});

/**
 * The provider's public status page, or null when none is verified.
 * @param {string} providerId
 * @returns {string|null}
 */
export const statusPageFor = (providerId) => STATUS_PAGES[providerId] ?? null;

/**
 * The desk-facing disruption notice for a failed witness turn, with the
 * provider's status page appended when one is verified. The desk renders
 * error messages through Markdown, whose autolink turns the bare URL into a
 * new-tab link. Pure.
 * @param {string} companionName
 * @param {string} errorMessage
 * @param {string} providerId
 * @returns {string}
 */
export const disruptionNotice = (companionName, errorMessage, providerId) => {
  const base = `[Connection to ${companionName} disrupted — ${errorMessage}`;
  const page = statusPageFor(providerId);
  return page ? `${base} — provider status: ${page}]` : `${base}]`;
};
