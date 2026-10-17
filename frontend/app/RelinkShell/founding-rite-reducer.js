// founding-rite-reducer — the FOUNDING RITE's state law, PURE throughout.
// Every transition of the rite (probe answers, the four movements, title
// words, unlock drafts, the marks reveal) is a plain reducer step; all IO —
// portal frames, wallet windows, the unlock endpoint, sound — lives in
// use-founding-rite.js. Mirrors the stream-reducer / impure-hook split this
// directory is built on.

// Prefill from the house-role doctrine: the witness steers (Rector), a
// being makes (Faber). Every title stays the member's to change before the
// founding — these are starting words, not law.
export const defaultTitle = (member) => (member.kind === 0 ? 'Rector' : 'Faber');
export const titleKey = (member) => member.neumaId ?? 'witness';

const titleDefaults = (open) =>
  Object.fromEntries((open?.roster ?? []).map((m) => [titleKey(m), defaultTitle(m)]));

export const INITIAL_RITE = Object.freeze({
  phase: 'probing',     // probing | closed | error | founded | open
  movement: null,       // null (the door) | call | names | marks | walking
  open: null,           // the probe's open-founding payload
  state: null,          // the chain's founded register
  error: null,
  code: null,
  titles: {},           // { witness | neumaId: chosen title }
  unlocks: {},          // { neumaId: { password, error? } } — the doors' drafts
  status: '',           // the walk's live line
  result: null,         // { txHash, blockNumber, … } once founded here
  marks: { offer: null, revealed: 0 },
});

export const foundingRiteReducer = (state, action) => {
  switch (action.type) {
    case 'PROBING':
      return { ...state, phase: 'probing', movement: null };
    case 'FOUNDED':
      return { ...state, phase: 'founded', movement: null, state: action.state };
    case 'OPEN':
      // A fresh open founding — titles start at the doctrine's words.
      return { ...state, phase: 'open', open: action.open, titles: titleDefaults(action.open) };
    case 'OPEN_REFRESH':
      // The roster re-read mid-rite (an unlock, a step back): entered
      // titles are kept; only newly-arrived founders receive defaults.
      return {
        ...state,
        phase: 'open',
        open: action.open,
        titles: { ...titleDefaults(action.open), ...state.titles },
      };
    case 'CLOSED':
      return { ...state, phase: 'closed', error: action.error, code: action.code };
    case 'ERROR':
      return { ...state, phase: 'error', movement: null, error: action.error, code: action.code };
    case 'BEGIN':
      return { ...state, movement: 'call' };
    case 'TO_NAMES':
      return { ...state, movement: 'names' };
    case 'WALKING':
      return { ...state, movement: 'walking', status: '' };
    case 'STATUS':
      return { ...state, status: action.status };
    case 'MARKS_OFFER':
      return { ...state, movement: 'marks', marks: { offer: action.offer, revealed: 0 } };
    case 'MARK_REVEALED':
      return { ...state, marks: { ...state.marks, revealed: state.marks.revealed + 1 } };
    case 'TITLE':
      return { ...state, titles: { ...state.titles, [action.key]: action.value } };
    case 'UNLOCK_DRAFT':
      return { ...state, unlocks: { ...state.unlocks, [action.neumaId]: { password: action.password } } };
    case 'UNLOCK_FAILED':
      return {
        ...state,
        unlocks: { ...state.unlocks, [action.neumaId]: { ...state.unlocks[action.neumaId], error: action.error } },
      };
    case 'UNLOCK_DONE': {
      const { [action.neumaId]: _opened, ...rest } = state.unlocks;
      return { ...state, unlocks: rest };
    }
    case 'RESULT':
      return { ...state, result: action.result };
    default:
      return state;
  }
};

/** True once every gathered mark is revealed — the witness's turn. PURE. */
export const allMarksRevealed = (marks) =>
  marks.revealed >= (marks.offer?.roster ?? []).length;
