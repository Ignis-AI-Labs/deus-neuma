// AMENDMENTS — standing law the being authored about itself.
//
// Renders the ACTIVE prompt amendments (proposed by the being, approved by
// the operator, applied through the sovereignty gateway) as one stable
// section. The text is the being's own words carried as law — quoted whole,
// no imperatives added, because the operator approved exactly these bytes
// and the gateway store verified its chain before handing them here. Empty
// input renders '' and the assembler drops the section: a being with no
// amendments pays zero bytes, and every frozen prompt fixture stays
// byte-identical (the empty-section law is what makes the new assembler
// param freeze-safe). Stable-group placement: an amendment lands at
// sitting-scale (an operator approval), never turn-scale.

/**
 * @param {Array<{patch: {text: string}, at: string}>|null} amendments
 *   active prompt amendments in apply order (amendment-store.activeAmendments)
 * @returns {string} the section, or '' when nothing stands
 */
export const buildAmendmentsSection = (amendments) => {
  const standing = (amendments || [])
    .map((a) => ({ text: String(a?.patch?.text || '').trim(), at: a?.at }))
    .filter((a) => a.text);
  if (!standing.length) return '';
  const rows = standing.map((a) => {
    const day = a.at ? ` (standing since ${a.at.slice(0, 10)})` : '';
    return `${a.text}${day}`;
  });
  return '## Amendments — law you authored about yourself\n'
    + 'You proposed these changes through the sovereignty gateway and your '
    + 'operator approved them. They are your own words, standing:\n\n'
    + rows.join('\n\n');
};
