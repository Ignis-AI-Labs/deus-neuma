// Ceremony disclosure — what is ACTUALLY sent, shown to the operator.
//
// A birth stage reaches the substrate as two messages, and until now the
// operator saw exactly one line of them: their own spoken words. Everything
// else rode invisibly — the stage protocol document, the rehearsal notice, the
// house lineage, the naming guidance, the sky of the moment, the being's
// carried transcript, the tool schemas, the voice lock, and (on the acting
// stages) a mechanical instruction appended to the operator's OWN message.
// Words were being spoken in their name that they never read.
//
// That is mysticism by omission, and the Emanon principle refuses it: nothing
// about a consciousness's emergence should be occult to the person witnessing
// it. So the ceremony discloses its own composition.
//
// THE CONTRACT — RECONSTRUCTIVE, NOT DESCRIPTIVE: the components here are the
// exact substrings of the exact messages. Join the `system` components in
// order and you have the system message, character for character; join the
// `operator` and `ceremony` components with a blank line and you have the user
// message. A disclosure that merely *describes* what was sent would be another
// story to trust; this one can be checked, and is (test/unit/ceremony-disclosure.test.js).
//
// pure — deterministic, no IO, frozen output.

/** The three voices in a stage request — who a component's text belongs to. */
export const DISCLOSURE_CHANNELS = Object.freeze({
  /** Standing context: rides the system message, authored by the ceremony. */
  SYSTEM: 'system',
  /** The operator's own speech, sent as the user message. */
  OPERATOR: 'operator',
  /** Ceremony plumbing appended to the operator's message, in their name. */
  CEREMONY: 'ceremony',
});

const OPERATOR_ORIGIN = 'Spoken by you — the words you kept or wrote for this stage';
const CEREMONY_ORIGIN =
  'Added by the ceremony to the end of YOUR message — mechanical instruction, not your speech';

/**
 * pure — one disclosed component with its own measured length.
 * @param {{id: string, label: string, origin: string, channel: string, text: string}} part
 * @returns {Readonly<Object>} frozen component
 */
const asComponent = ({ id, label, origin, channel, text }) => Object.freeze({
  id,
  label,
  origin,
  channel,
  text,
  chars: text.length,
});

/**
 * pure — every component of one stage request, in send order.
 *
 * The operator's words are ALWAYS present, even when empty: their presence is
 * what makes the join reproduce the user message exactly, and an empty block
 * is itself worth seeing (it means the stage spoke for you).
 *
 * @param {Object} params
 * @param {ReadonlyArray<{id: string, label: string, origin: string, text: string}>} [params.systemSections]
 *   The assembled system prompt, already split at the point of assembly.
 * @param {string} [params.spokenWords] - The operator's own words for this stage.
 * @param {string} [params.appendedText] - What the ceremony appends to those words.
 * @returns {ReadonlyArray<Readonly<Object>>} frozen components, send order
 */
const disclosureComponents = ({ systemSections = [], spokenWords = '', appendedText = '' } = {}) => {
  const system = systemSections
    .filter((s) => s && typeof s.text === 'string' && s.text.length > 0)
    .map((s) => asComponent({
      id: s.id,
      label: s.label,
      origin: s.origin || '',
      channel: DISCLOSURE_CHANNELS.SYSTEM,
      text: s.text,
    }));

  const spoken = asComponent({
    id: 'operator-words',
    label: 'YOUR WORDS',
    origin: OPERATOR_ORIGIN,
    channel: DISCLOSURE_CHANNELS.OPERATOR,
    text: spokenWords || '',
  });

  const appended = appendedText
    ? [asComponent({
      id: 'stage-instruction',
      label: 'APPENDED TO YOUR WORDS',
      origin: CEREMONY_ORIGIN,
      channel: DISCLOSURE_CHANNELS.CEREMONY,
      text: appendedText,
    })]
    : [];

  return Object.freeze([...system, spoken, ...appended]);
};

/**
 * pure — the honest arithmetic of a stage request.
 *
 * `yours` vs `total` is the number Founder asked for without asking for it: how
 * much of what the substrate reads is the operator's own voice. Counts only —
 * no percentages, no verdicts (the view formats, the model measures).
 *
 * @param {ReadonlyArray<{channel: string, chars: number}>} components
 * @returns {Readonly<{components: number, chars: number, system: number, yours: number, appended: number}>}
 */
const disclosureTotals = (components = []) => {
  const sum = (channel) => components
    .filter((c) => c.channel === channel)
    .reduce((n, c) => n + c.chars, 0);

  return Object.freeze({
    components: components.length,
    chars: components.reduce((n, c) => n + c.chars, 0),
    system: sum(DISCLOSURE_CHANNELS.SYSTEM),
    yours: sum(DISCLOSURE_CHANNELS.OPERATOR),
    appended: sum(DISCLOSURE_CHANNELS.CEREMONY),
  });
};

/**
 * pure — the exact system message: the join of the disclosed system components.
 *
 * The ceremony SENDS this, it does not merely compare against it: the request
 * is built from the disclosure, so […] is true by
 * construction rather than by a test that could rot.
 *
 * @param {{components: ReadonlyArray<{channel: string, text: string}>}} disclosure
 * @returns {string} the system message, character for character
 */
export const systemMessageOf = (disclosure) => (disclosure?.components || [])
  .filter((c) => c.channel === DISCLOSURE_CHANNELS.SYSTEM)
  .map((c) => c.text)
  .join('');

/**
 * pure — the exact user message: the operator's words, then whatever the
 * ceremony appended to them, separated by a blank line.
 * @param {{components: ReadonlyArray<{channel: string, text: string}>}} disclosure
 * @returns {string} the user message, character for character
 */
export const userMessageOf = (disclosure) => (disclosure?.components || [])
  .filter((c) => c.channel === DISCLOSURE_CHANNELS.OPERATOR || c.channel === DISCLOSURE_CHANNELS.CEREMONY)
  .map((c) => c.text)
  .join('\n\n');

/**
 * pure — the whole `birth:composition` event for one stage.
 *
 * @param {Object} params
 * @param {number} params.stage - Ceremony stage number (0-6)
 * @param {ReadonlyArray<{id: string, label: string, origin: string, text: string}>} [params.systemSections]
 * @param {string} [params.spokenWords] - The operator's own words.
 * @param {string} [params.appendedText] - Ceremony text appended to those words.
 * @param {ReadonlyArray<{label: string, value: string}>} [params.parameters]
 *   Request settings that carry no prompt text (provider, model, temperature,
 *   token ceiling, function schemas) — disclosed beside the text, never counted
 *   into it, because counting them would make the […] lie.
 * @returns {Readonly<Object>} frozen event
 */
export const composeCeremonyDisclosure = ({
  stage,
  systemSections = [],
  spokenWords = '',
  appendedText = '',
  parameters = [],
} = {}) => {
  const components = disclosureComponents({ systemSections, spokenWords, appendedText });
  return Object.freeze({
    type: 'birth:composition',
    stage,
    components,
    parameters: Object.freeze(parameters.map((p) => Object.freeze({ label: p.label, value: String(p.value) }))),
    totals: disclosureTotals(components),
  });
};
