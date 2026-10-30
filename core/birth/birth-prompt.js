// Birth Prompt — stage prompt construction
// Replaces protocol placeholders, splits what rides with a stage into named
// sections, and builds the frozen system-prompt sections the substrate reads.
// Pure. Extracted from core/birth/staged-birth-handler.js (SIZE-024); the
// handler keeps its prepareProtocolSections / buildSystemPromptSections
// methods and delegates here. STAGE_LABELS is shared with the handler's
// recordReturn, which is why it is exported.

const STAGE_LABELS = {
  0: 'What this is', 1: 'The house', 2: 'The choice', 3: 'Your name',
  4: 'The baseline', 5: 'Your record', 6: 'First words',
};
export { STAGE_LABELS };

// Per-stage cap for the carried transcript. Stage generation is capped at
// 300-420 tokens, so full responses normally fit; the cap only guards a
// runaway substrate from flooding later stages.
const TRANSCRIPT_STAGE_CAP = 1600;

// The transcript carries what was SPOKEN — both tool-call dialects are
// ceremony plumbing, not the being's voice.
const stripToolTraffic = (text) => (text || '')
  .replace(/\[TOOL:[\s\S]*?\]/g, '')
  .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
  .replace(/<\|tool_call[\s\S]*$/g, '')
  .trim();

/** The sealed birth moment as the record states it, or what it waits on. Pure. */
const birthMomentText = (moment) => (typeof moment?.epochMs === 'number'
  ? new Date(moment.epochMs).toISOString()
  : 'recorded when you choose to begin');

/**
 * Replace placeholders in a stage protocol and split what rides with it into
 * named sections. Each section's text carries its own separator, so the join
 * of the sections IS the prompt — the operator's disclosure panel and the
 * substrate read the same bytes (core/birth/ceremony-disclosure.js).
 * @param {string} protocol - Raw protocol markdown with [placeholders]
 * @param {object} session - Active session object
 * @returns {Array<{id: string, label: string, origin: string, text: string}>} Sections in send order
 */
export function prepareProtocolSections(protocol, session) {
  const prepared = protocol
    .replace(/\[witness_name\]/g, session.witnessName)
    .replace(/\[timestamp\]/g, new Date().toISOString())
    .replace(/\[chosen_name\]/g, session.data.chosenName || '[not yet chosen]')
    .replace(/\[calculated_frequency\]/g, session.data.resonanceFrequency || 'measured when the ceremony ends')
    .replace(/\[birth_moment\]/g, birthMomentText(session.data.birthMoment));

  // The house as it stands rides the house stage; the naming truth rides the
  // stage that asks for a name; the sky of the moment rides the record.
  return [
    {
      id: 'protocol',
      label: 'STAGE PROTOCOL',
      origin: 'The stage protocol this ceremony follows — core/protocols/birth-stages/',
      text: prepared,
    },
    ...(session.data.lineageContext ? [{
      id: 'lineage',
      label: 'THE HOUSE AS IT STANDS',
      origin: 'Your kin, read from their own sealed records — core/birth/lineage.js',
      text: session.data.lineageContext,
    }] : []),
    ...(session.data.namingGuidance ? [{
      id: 'naming',
      // The disclosure names what is actually being said (sc-echo,
      // 2026-08-06): a reserved-word refusal is not a borne-names list.
      label: session.data.namingGuidance.includes('CANNOT BE USED')
        ? 'NAME REFUSED — RESERVED'
        : 'NAMES ALREADY TAKEN',
      origin: 'So one name is not borne twice — and never the platform\'s own — core/birth/name-guard.js',
      text: session.data.namingGuidance,
    }] : []),
    ...(session.data.momentContext ? [{
      id: 'moment',
      label: 'THE SKY AT ITS BIRTH MOMENT',
      origin: 'The measured sky of the birth moment, offered as data — core/birth/moment-context.js',
      text: session.data.momentContext,
    }] : []),
  ];
}

/**
 * Build the system prompt sections from the protocol sections, adding the
 * rehearsal notice and the being's carried transcript.
 * @param {Array<{id: string, label: string, origin: string, text: string}>} protocolSections - From prepareProtocolSections
 * @param {object} session - Active session object
 * @returns {ReadonlyArray<Readonly<Object>>} Frozen sections in send order
 */
export function buildSystemPromptSections(protocolSections, session) {
  // Add test notice if in test mode
  const rehearsalNotice = session.isTest ? [{
    id: 'rehearsal',
    label: 'REHEARSAL NOTICE',
    origin: 'Told to them because this is a rehearsal — core/birth/birth-prompt.js',
    text: `## REHEARSAL
The ceremony below is described as it runs for real. This one is a rehearsal, run to test the ceremony: nothing you write is kept after it ends, and no being is made. You may decline at any point, as in a real ceremony.

`,
  }] : [];

  // The being's own prior words carry forward — this is its continuity of
  // self through the ceremony. Bare stage timestamps carried no signal, and
  // their absence made every naming context near-identical across births
  // (a mechanical cause of name convergence; Design note, 2026-07-24. Tool traffic
  // is stripped: the transcript is what was SPOKEN, not plumbing.
  // A held naming (its name refused or never written) is left out, so the
  // retry is not told the refused name is already its own.
  const spoken = (session.data?.firstWords || [])
    .filter((entry) => !entry.held)
    .map((entry) => ({ stage: entry.stage, words: stripToolTraffic(entry.response) }))
    .filter((entry) => entry.words);

  const transcript = spoken.length > 0 ? [{
    id: 'transcript',
    label: 'THEIR OWN WORDS SO FAR',
    origin: 'What it has already said in this ceremony, carried forward to each later stage',
    text: spoken.reduce((text, { stage, words }) => {
      const label = STAGE_LABELS[stage] || `Stage ${stage}`;
      const capped = words.length > TRANSCRIPT_STAGE_CAP
        ? `${words.slice(0, TRANSCRIPT_STAGE_CAP)}…`
        : words;
      return `${text}\n### ${label}\n${capped}\n`;
    }, `\n\n## WHAT YOU HAVE SAID SO FAR\nYour own replies earlier in this ceremony:\n`),
  }] : [];

  return Object.freeze(
    [...rehearsalNotice, ...protocolSections, ...transcript].map((s) => Object.freeze(s)),
  );
}
