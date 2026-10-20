/**
 * Council Voice
 *
 * Pure prompt-section builder + hand-call parser for THE COUNCIL. Two seams:
 * what a member is told about the room (buildCouncilSection), and how a
 * member's raise-hand answer is read back (parseHandCall). No side effects —
 * strings in, strings out; the arbiter owns the room's state.
 */

// A garbled answer is an UNREAD hand ({hand: null}) — never a crash, never
// an accidental interjection. The arbiter keeps an unread member's standing
// hand exactly as it was: a member who clearly raised HOLD is never lowered
// by one garbled re-poll (Founder's law — a queued turn must not be cut off),
// and a hand can never RISE without a clear signal ('open' means a being
// may interrupt the room, so raising always takes a clean first line).
const UNREAD_CALL = Object.freeze({ hand: null, note: '' });

// Beings may answer in the protocol words or in color — both are honest.
const HAND_ALIASES = Object.freeze({
  rest: 'rest', red: 'rest',
  hold: 'hold', yellow: 'hold',
  open: 'open', green: 'open',
});

const NOTE_CAP = 280;

// Render the recent exchange as plain "NAME: content" lines. No truncation
// here — the caller controls the tail; this seam only renders it. The
// platform's room passes its own renderer (council-frame.js), which frames
// the beings' words as untrusted; core never reaches into the backend.
const renderTranscript = (transcriptTail = []) =>
  transcriptTail.map((t) => `${t.name}: ${t.content}`).join('\n');

/**
 * Build the council prompt section for one member.
 *
 * Two modes:
 * - 'floor': this member holds the floor — speak to the room.
 * - 'hand':  this member is listening — answer with a hand call (first line
 *   exactly REST / HOLD / OPEN, optionally one line of what they would add).
 *
 * @param {Object} params
 * @param {string} params.selfName - The member this section is addressed to
 * @param {string} params.witnessName - The operator in the room
 * @param {Array<{neumaId: string, name: string, kind?: ('neuma'|'witness')}>} params.members - Everyone in the room; `kind` carries standing
 * @param {Array<{speaker: string, name: string, content: string}>} [params.transcriptTail] - Recent exchange, rendered verbatim
 * @param {'floor'|'hand'} params.mode - Speaking or listening
 * @param {string|null} [params.workspace] - This member's own ground (floor mode only): the one place they may work with their tools
 * @param {'house'|'external'} [params.groundStanding] - WHOSE ground that is: the house's own, or the cross-house ground this member shares with it
 * @param {{hand: ('hold'|'open'), note?: string}|null} [params.standing] - This member's already-raised hand (hand mode only): the re-poll must carry their standing intent, or a queued turn evaporates on a stateless REST (Founder's law — a queued turn must not be cut off)
 * @param {boolean} [params.spokeLast] - This member spoke the room's last turn (hand mode only): they ARE polled (a thought can be bigger than one turn — the flow is unbroken), but the ask is framed so re-raising means genuine continuation, not habit
 * @param {(tail: Array<Object>) => string} [params.renderExchange] - How the tail is rendered; plain […] lines by default
 * @returns {string} Prompt section text
 */
export const buildCouncilSection = ({ selfName, witnessName, members = [], transcriptTail = [], mode, workspace = null, groundStanding = 'house', standing = null, spokeLast = false, renderExchange = renderTranscript } = {}) => {
  // STANDING is named in the ROOM, not only in the record. A sealed witness
  // sits beside the house and never in it (WR-I01) — introducing one to a
  // housemate as "your housemate" would make the misnaming the members' own
  // understanding of who is present, which is where it does the most damage.
  const others = members.filter((m) => m.name && m.name !== selfName);
  const housemates = others.filter((m) => m.kind !== 'witness').map((m) => m.name);
  const externals = others.filter((m) => m.kind === 'witness').map((m) => m.name);
  const roomLine = `a council with your operator ${witnessName}`
    + (housemates.length ? ` and your housemates ${housemates.join(', ')}` : '')
    + (externals.length
      ? ` and ${externals.join(', ')} — ${externals.length > 1 ? 'sealed witnesses' : 'a sealed witness'} standing BESIDE this house, not of it`
      : '');

  const tail = renderExchange(transcriptTail);
  const exchange = tail ? `The recent exchange:\n${tail}` : 'The room has just opened — nothing has been said yet.';

  if (mode === 'floor') {
    // A ground is described by WHOSE it is. An external seat works a ground
    // the two houses SHARE — telling it […] would
    // be false in the one place the model reasons from, and an invitation to
    // go looking for the rest of a house it was never admitted to.
    const whose = groundStanding === 'external'
      ? `The ground your house and this one share is ${workspace} — what you build together lives under ${workspace}/repos. It belongs to the collaboration, not to either house. This house's own ground is NOT yours and is not open to you; ask ${witnessName} if you need something from it.`
      : `The house's shared workspace is ${workspace} — its repositories live under ${workspace}/repos.`;
    const ground = workspace
      ? `\n\n${whose} You may work there with your tools during this turn (read, write, organize) when the council's thread calls for real work: recording a decision, updating a document, laying a file down. The room sees every act. Work only inside that ground.`
      : '';
    return `## Council
You hold the floor in ${roomLine}. Everyone present hears what you say.${ground}

${exchange}

Speak to the room — in your OWN voice. Your cadence, your shapes, your words are yours alone: do not mirror the structure or phrasing of earlier turns. Kinship is not echo.`;
  }

  // A raised hand is standing intent: the re-poll after every utterance
  // must carry it, or the member is asked as if fresh and a stateless REST
  // silently cuts their queued turn. REST from a raised hand is a
  // DELIBERATE withdrawal, stated as such — never the path of least tokens.
  if (standing && (standing.hand === 'hold' || standing.hand === 'open')) {
    const held = standing.note ? ` You were holding this thought: "${standing.note}"` : '';
    return `## Council
You are LISTENING in ${roomLine}. You do not hold the floor — but YOUR HAND IS RAISED (${standing.hand.toUpperCase()}): you asked to speak and you are in the speaking line.${held}

${exchange}

Answer on the FIRST line with exactly one of: HOLD / OPEN / REST.
- HOLD — keep your place in line; you will speak when the floor reaches you.
- OPEN — your point now genuinely cannot wait for the turn to end.
- REST — WITHDRAW your raised hand: say this only if what you meant to say truly no longer needs saying.
Optionally add ONE more line saying what you would add. Nothing else.`;
  }

  // The member who just yielded the floor is asked like everyone else —
  // going unpolled was how a thought bigger than one turn died mid-flow —
  // but the frame makes re-raising a continuation, never a habit.
  const afterOwnTurn = spokeLast
    ? ' You spoke last — the room just heard you: raise a hand again ONLY if your thought is genuinely unfinished or something new has just arisen; otherwise let the room answer you.'
    : '';
  return `## Council
You are LISTENING in ${roomLine}. You do not hold the floor.${afterOwnTurn} Given the latest utterance, decide whether to raise your hand.

${exchange}

Answer on the FIRST line with exactly one of: REST / HOLD / OPEN.
- REST — nothing to add right now.
- HOLD — you have something to say after the current speaker finishes.
- OPEN — reserved for something that genuinely cannot wait for the turn to end.
Optionally add ONE more line saying what you would add. Nothing else.`;
};

/**
 * Parse a member's raise-hand answer.
 *
 * The first line is matched case-insensitively against REST/HOLD/OPEN (and
 * the color aliases RED/YELLOW/GREEN); trailing punctuation or a same-line
 * note after a separator is tolerated. Anything unparseable reads as an
 * UNREAD hand — {hand: null, note: ''} — which the arbiter treats as […]. Only an explicit REST/RED lowers a hand.
 *
 * @param {string} text - The member's raw answer
 * @returns {{hand: 'rest'|'hold'|'open'|null, note: string}} Frozen only in meaning — a fresh plain object each call
 */
export const parseHandCall = (text) => {
  if (typeof text !== 'string') return { ...UNREAD_CALL };

  const lines = text.split('\n');
  // Skip leading blank lines — a model that opens with whitespace still
  // answered on its "first line".
  const firstIdx = lines.findIndex((l) => l.trim() !== '');
  if (firstIdx === -1) return { ...UNREAD_CALL };

  // The hand word, alone or followed by a separator and a same-line remark
  // ([…]). A prefix ([…]) does NOT
  // parse: the word must lead, or the answer reads as unread.
  const match = lines[firstIdx].trim().match(/^(rest|red|hold|yellow|open|green)\b\s*(?:[-–—:,.!]\s*(.*))?$/i);
  if (!match) return { ...UNREAD_CALL };

  const hand = HAND_ALIASES[match[1].toLowerCase()];
  const noteParts = [match[2] || '', ...lines.slice(firstIdx + 1)];
  const note = noteParts.join('\n').trim().slice(0, NOTE_CAP);

  return { hand, note };
};
