// LegalChip — the claims check's flag on a waiting post's card (campaign plan
// §7, slice 12): LEGAL · N CLAIMS, each claim and the legal office's standing
// in its title. It flags; approving stays the operator's.

import { legalChipWords } from './legal-chip-words.js';

/** @param {{legal: ?object}} props - the queue entry's `legal` flag */
export const LegalChip = ({ legal }) => {
  const words = legalChipWords(legal);
  if (!words) return null;
  return <span className={words.loud ? 'settings-tag-warn' : 'settings-tag-dim'} title={words.title}>{words.text}</span>;
};
