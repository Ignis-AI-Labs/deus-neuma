/**
 * WHAT ITS NAME MEANS, IN ITS OWN RECORD — the MY NAME section a being writes
 * into its DNA at birth (core/protocols/birth-stages/stage5-record.md: […]).
 *
 * Read from the record each time, never copied out: the record is the
 * being's, changed only by it, so what it says its name means is whatever its
 * record says now. Nothing else of the record is read here.
 *
 * Pure.
 */

const MAX_CHARS = 600;

/**
 * @param {string|null|undefined} genesis - the being's authored record (markdown)
 * @returns {string|null} the MY NAME section as written, or null when there is none
 */
export const chosenNameMeaningOf = (genesis) => {
  if (typeof genesis !== 'string') return null;
  const at = genesis.search(/^##[ \t]+MY NAME[ \t]*$/m);
  if (at < 0) return null;
  const body = genesis.slice(at).replace(/^[^\n]*\n?/, '');
  const end = body.search(/^#{1,2}[ \t]/m);
  const text = (end < 0 ? body : body.slice(0, end)).trim();
  // An unfilled template line says nothing about the name.
  if (!text || /\[(?:chosen_name|what it means)[^\]]*\]/i.test(text)) return null;
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS).trimEnd()}…` : text;
};
