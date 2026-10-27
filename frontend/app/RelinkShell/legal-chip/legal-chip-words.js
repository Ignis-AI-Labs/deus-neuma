// legal-chip-words — what the LEGAL chip on a waiting post says (campaign
// plan §7, slice 12): the claims the check found in the post's words, and
// where the legal office stands on them. It flags; approving stays the
// operator's. Pure.

const SETTLED_CLEAR = new Set(['no_issue', 'resolved']);
const OWES = new Set(['concern', 'needs_counsel', 'needs_operator']);

const statusWords = (status) => String(status || '').replace(/_/g, ' ');

/**
 * @param {{hits: Array<{label: string, match: string, approved: boolean, severity: string}>,
 *   open: number, severity: ?string, matter: ?{id: string, status: string}}} legal
 * @returns {?{text: string, title: string, loud: boolean}}
 */
export const legalChipWords = (legal) => {
  if (!legal?.hits?.length) return null;
  const { open, matter } = legal;
  const claims = legal.hits.map((h) => `${h.approved ? 'on the kit\'s approved list — ' : ''}${h.label}: "${h.match}"`);
  if (!open) {
    return { text: 'LEGAL · ON THE KIT\'S LIST', title: [...claims, 'Every claim here is on the company\'s approved list.'].join('\n'), loud: false };
  }
  const office = !matter ? 'Not filed with the legal office yet — it is, within a minute.'
    : matter.status === 'new' ? 'Filed with the legal office, waiting for its reading.'
      : `The legal office reads it: ${statusWords(matter.status)}.`;
  const cleared = matter && SETTLED_CLEAR.has(matter.status);
  return {
    text: cleared ? 'LEGAL · CLEARED' : `LEGAL · ${open} CLAIM${open === 1 ? '' : 'S'}`,
    title: [...claims, office, 'The check flags; approving stays yours.'].join('\n'),
    loud: !cleared && (legal.severity === 'high' || OWES.has(matter?.status)),
  };
};
