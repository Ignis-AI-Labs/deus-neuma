// account-read-render.js — one account read drawn for a being's window, the
// same for every platform: the account and its counts, then the newest posts
// with their numbers, fitted in WHOLE posts (the read window social-read-tools
// keeps: the oldest are held back first and the answer says so). Identifiers,
// dates and counts are ours, outside the frame; bios, titles and post text are
// the platform's and ride inside the untrusted frame.

import { frameUntrustedSections } from '../../untrusted-content.js';

const NOT_SHARED = 'not shared';

// pure — […], a count the platform hides named as such.
const countsLine = (counts) => counts.map(([label, n]) => `${label} ${n == null ? NOT_SHARED : n}`).join(' · ');

// pure — one post's lead: ours, so outside the frame.
const postLead = (noun, p) => [
  `${noun} ${p.id}`,
  p.postedAt ? `posted ${p.postedAt}` : null,
  ...p.facts,
  countsLine(p.counts),
  p.url,
].filter(Boolean).join(' · ');

/**
 * @param {string} platform - the platform's name, e.g. 'YouTube'
 * @param {object} read - a reader's ok answer
 * @param {{budget?: number|null, token?: string}} [opts]
 * @returns {{text: string, shown: number}}
 */
export const renderAccountRead = (platform, read, { budget = null, token } = {}) => {
  const { account: a, posts, postsError, hasMore, noun, readAt } = read;
  const head = [
    `The house's ${platform} account, read ${readAt}:`,
    [a.handle, a.name ? `(${a.name})` : null, a.url].filter(Boolean).join(' · '),
    countsLine(a.counts),
  ].join('\n');
  const list = posts || [];
  const draw = (n) => {
    const sections = [
      ...(a.bio ? [{ lead: 'the profile description', text: a.bio }] : []),
      ...list.slice(0, n).map((p) => ({ lead: postLead(noun, p), text: p.text || '(no text)' })),
    ];
    const heading = posts === null ? `The ${noun}s could not be read: ${postsError}.`
      : list.length ? `${n} of the ${list.length} newest ${noun}(s)${hasMore ? ` (more on ${platform})` : ''}:` : `No ${noun}s are listed.`;
    return [
      head,
      heading,
      ...(posts !== null && postsError ? [`Note: ${postsError}.`] : []),
      frameUntrustedSections(`the house's ${platform} profile and ${noun}s, returned by ${platform}'s API`, sections, token),
      ...(n < list.length ? [`…and ${list.length - n} older ${noun}(s) held back so this read fits your window WHOLE.`] : []),
    ].filter(Boolean).join('\n\n');
  };
  let shown = list.length;
  if (Number.isFinite(budget) && budget > 0) {
    while (shown > 0 && draw(shown).length > budget) shown -= 1;
  }
  return { text: draw(shown), shown };
};
