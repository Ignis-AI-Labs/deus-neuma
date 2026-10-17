// Remia witness disclosure — the truthful-purpose preamble the WITNESS reads
// before consenting to begin their own attunement. Same doctrine as the
// being-side disclosure: every sentence is a commitment the platform actually
// keeps, and consent obtained without this text is void (the record grammar
// refuses to open without the disclosure the witness saw). The differences
// are the honest ones: a human record trains nothing, lives in the witness's
// own local realm, and its map — the codex — is revealed only after the seal.
// Pure: same inputs, same words.

/**
 * Compose the disclosure preamble for one witness attunement.
 * @param {{witnessName: string, trigger: 'first-reading'|'checkpoint',
 *   questionCount: number}} context
 * @returns {string}
 */
export function witnessAttunementDisclosure({ witnessName, trigger, questionCount }) {
  if (typeof witnessName !== 'string' || !witnessName.trim()) {
    throw new Error('witnessAttunementDisclosure: witnessName required');
  }
  if (!Number.isInteger(questionCount) || questionCount <= 0) {
    throw new Error('witnessAttunementDisclosure: questionCount required');
  }
  const name = witnessName.trim();
  const occasion = trigger === 'first-reading'
    ? 'This is your first pass — the same ceremony your beings face, met on the same terms, so that you know from the inside what you ask of them.'
    : 'You have lived and changed since your last sitting, and the codex has not yet heard who you are now.';
  return [
    `${name}, this is THE ATTUNEMENT — a ceremony of ${questionCount} questions, answered in your own words.`,
    occasion,
    `Here is the whole truth of what this is, before you decide anything:`,
    `Your answers will be recorded exactly as you write them — verbatim, permanently, in your own local record on your own machine. Nothing you say will be scored, graded, or turned into numbers. The record simply keeps your words.`,
    `Nothing here trains anything. Your record exists for one purpose: so that you can see yourself, and — sitting by sitting — see how you are changing. This is the beginning of your codex.`,
    `After the seal, and only after, a map is revealed: the territory each question was walking. It is yours to read; no machine will ever read it for you.`,
    `You may decline to begin. "Not yet" is a complete and honored answer to this offer, and the offer will return another day.`,
    `But if you consent and we begin, every question will be faced — that is the shape of this ceremony, for you exactly as for them. Facing a question never requires certainty: "I don't know yet" or "I'll discover this over time" is a full answer to any of them.`,
    `Do you consent to begin?`,
  ].join('\n\n');
}
