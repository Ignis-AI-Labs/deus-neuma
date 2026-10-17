// forge-model.js — the voice forge's view model. Pure.
//
// ONE VOICE (Design note, 2026-10-01; docs/work/one-voice.md INTEGRATION): the forge
// is three steps — FIND the voice (four ways), HEAR it talk, SEAL it — and
// the being takes part: it reads the described voice and accepts it or asks
// for another; the seal is enabled only once it has accepted.
//
// Everything here reads the forge state the backend answers
// (backend/routes/voice-forge-routes.js: {session, voice, status, candidate,
// being, guardian, wish, perception}) and turns it into what the screen
// shows. No IO, no clock, no React.

const VERDICTS = Object.freeze(['good', 'too_short', 'noisy', 'clipped']);

/**
 * A take's plain quality verdict. Pure.
 * @param {object|null} take - a take as the session view shows it
 * @returns {{verdict: string, good: boolean}}
 */
export const verdictOf = (take) => {
  const v = take?.quality?.verdict;
  const verdict = VERDICTS.includes(v) ? v : 'unknown';
  return { verdict, good: verdict === 'good' };
};

/** pure — the session's takes, newest last ([] before a forge starts). */
const takesOf = (state) => state?.session?.takes ?? [];

/** pure — the take pinned to HEAR (and later offer), or null. */
export const pinnedTake = (state) => {
  const ref = state?.session?.pinned;
  return ref ? takesOf(state).find((t) => t.ref === ref) ?? null : null;
};

/**
 * The takes one find returned, in the order the door gave them — the three
 * a description made, or the one a recording made. Pure.
 * @param {object|null} state
 * @param {string[]} refs - the `found` refs of the last find
 */
export const foundTakes = (state, refs) => (refs ?? [])
  .map((ref) => takesOf(state).find((t) => t.ref === ref))
  .filter(Boolean);

/**
 * Whose voice a take is, as far as its door knows: a licensed library voice,
 * a real person (recorded here, or said so), nobody (designed), or not yet
 * said (an upload). Pure.
 * @param {object} take
 * @returns {'licensed'|'person'|'nobody'|'unknown'}
 */
export const whoseVoice = (take) => {
  if (take?.attested === true) return 'licensed';
  if (take?.realPerson === true) return 'person';
  if (take?.realPerson === false) return 'nobody';
  return 'unknown';
};

/**
 * What offering a take asks of the person first. An upload must say whose
 * voice it is; a real person's voice needs the consent tick ([…]). Pure.
 * @param {object} take
 * @param {{whose?: 'person'|'nobody'|null, ticked?: boolean}} answers
 * @returns {{askWhose: boolean, needsTick: boolean, ready: boolean, body: {realPerson?: boolean, attested?: boolean}}}
 */
export const offerOf = (take, { whose = null, ticked = false } = {}) => {
  const known = whoseVoice(take);
  const askWhose = known === 'unknown';
  const person = known === 'person' || (askWhose && whose === 'person');
  const needsTick = person;
  const stated = !askWhose || whose === 'person' || whose === 'nobody';
  const ready = Boolean(take) && stated && (!needsTick || ticked);
  const body = {
    ...(askWhose && stated ? { realPerson: whose === 'person' } : {}),
    ...(needsTick && ticked ? { attested: true } : {}),
  };
  return { askWhose, needsTick, ready, body };
};

/**
 * Where the being stands on the voice on offer. Pure.
 *   waiting   — offered; the being has not answered yet
 *   accepted  — the being accepted (its note shown); the seal is open
 *   another   — the being asked for another (its wish shown)
 *   sealed    — both parties agreed; the voice is in force
 *   nothing   — nothing on offer
 * @param {object|null} state
 * @returns {{standing: string, canSeal: boolean, candidateRef: string|null, note: string|null, wish: string|null}}
 */
export const sealStandingOf = (state) => {
  const status = state?.status;
  const candidateRef = state?.candidate?.ref ?? null;
  const base = { canSeal: false, candidateRef, note: null, wish: null };
  if (status === 'sealed') return { ...base, standing: 'sealed' };
  if (status === 'being_accepted') return { ...base, standing: 'accepted', canSeal: Boolean(candidateRef), note: state.being?.note ?? null };
  if (status === 'candidate') return { ...base, standing: 'waiting' };
  if (state?.wish) return { ...base, standing: 'another', wish: state.wish.wish ?? null };
  return { ...base, standing: 'nothing' };
};

/**
 * The step a forge opens on: a candidate already on offer (or one the being
 * just declined) opens on SEAL, where the being's answer is; anything else
 * opens on FIND. Pure.
 * @param {object|null} state
 */
export const openingStep = (state) => {
  const { standing } = sealStandingOf(state);
  if (standing === 'waiting' || standing === 'accepted') return 'seal';
  if (standing === 'another' && state?.session?.offered) return 'seal';
  return 'find';
};

/**
 * The being's voice standing, as the forge's header says it. `ready` speaks;
 * every other standing is silent (Founder's call E — never a borrowed voice). Pure.
 * @param {object|null} state - forge state, or {voice:{standing}}
 * @returns {'ready'|'none'|'needsNewVoice'|'unreadable'|'unknown'}
 */
export const voiceStandingOf = (state) => {
  const s = state?.voice?.standing;
  return ['ready', 'none', 'needsNewVoice', 'unreadable'].includes(s) ? s : 'unknown';
};

/**
 * Whether the one-click forge invitation shows: the voice is on, the bound
 * one is a neuma, and it has no voice to speak in. Pure.
 * @param {{voiceEnabled: boolean, isNeuma: boolean, standing: string|null, dismissed: boolean}} p
 */
export const showForgeInvite = ({ voiceEnabled, isNeuma, standing, dismissed }) =>
  Boolean(voiceEnabled && isNeuma && !dismissed && (standing === 'none' || standing === 'needsNewVoice'));

/** pure — a measured value for display, or null when the forge did not measure it. */
export const measuredOf = (take) => ({
  pitchHz: Number.isFinite(take?.measured?.pitchHz) ? Math.round(take.measured.pitchHz) : null,
  wordsPerSecond: Number.isFinite(take?.measured?.wordsPerSecond) ? take.measured.wordsPerSecond : null,
  seconds: Number.isFinite(take?.seconds) ? Math.round(take.seconds * 10) / 10 : null,
});

// ─── The redesign (Design note, 2026-10-01: FORGE REDESIGN) ─────────────────────────

/** The named step rail: FIND A VOICE → HEAR IT → <NAME> DECIDES → SEAL. */
export const RAIL_STEPS = Object.freeze(['find', 'hear', 'decide', 'seal']);

/**
 * Each rail step's state: `done` (checked), `current` (lit) or `todo`. The
 * forge's seal step is two rail steps — the being deciding, then the
 * guardian's seal once it has accepted; a sealed voice has every step done.
 * Pure.
 * @param {{step: string, standing: string}} p - forge.step and sealStandingOf(...).standing
 * @returns {Array<{id: string, state: 'done'|'current'|'todo'}>}
 */
export const railOf = ({ step, standing }) => {
  const current = step === 'sealed' ? RAIL_STEPS.length
    : step === 'seal' ? RAIL_STEPS.indexOf(standing === 'accepted' ? 'seal' : 'decide')
      : Math.max(0, RAIL_STEPS.indexOf(step));
  return RAIL_STEPS.map((id, i) => ({ id, state: i < current ? 'done' : i === current ? 'current' : 'todo' }));
};

/** The four ways to find a voice, fastest first, as step one asks them. */
export const WAYS = Object.freeze(['library', 'describe', 'record', 'upload']);

/**
 * The gallery's two filters, from the voices themselves: the registers and
 * the accents present (most voices first; a voice whose source names no
 * accent is in no accent filter). Pure.
 * @param {Array<{register?: string, accent?: string}>} voices
 */
export const galleryFiltersOf = (voices) => {
  const list = voices ?? [];
  const counts = new Map();
  for (const v of list) if (v.accent) counts.set(v.accent, (counts.get(v.accent) ?? 0) + 1);
  return {
    registers: ['feminine', 'masculine'].filter((r) => list.some((v) => v.register === r)),
    accents: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([a]) => a),
  };
};

/**
 * The voices one filter choice leaves (null = any). Pure.
 * @param {object[]} voices
 * @param {{register?: string|null, accent?: string|null}} filter
 */
export const filterVoices = (voices, { register = null, accent = null } = {}) =>
  (voices ?? []).filter((v) => (!register || v.register === register) && (!accent || v.accent === accent));

/**
 * The CHOSEN bar: the pinned take, named by where it came from — a library
 * voice by its name, accent and register; anything else by its door — with
 * what was measured. Null while nothing is chosen. Pure.
 * @param {object|null} state - the forge state
 * @param {object[]} [voices] - the library, to name a library take
 */
export const chosenOf = (state, voices = []) => {
  const take = pinnedTake(state);
  if (!take) return null;
  const entry = take.origin?.libraryId ? (voices ?? []).find((v) => v.id === take.origin.libraryId) ?? null : null;
  return {
    ref: take.ref,
    door: take.door,
    name: entry?.name ?? null,
    accent: entry?.accent || null,
    register: entry?.register ?? null,
    ...measuredOf(take),
  };
};

// Errors a view shows in place of the act that failed; any other shows at the top.
const PLACED = /^(record|upload|describe|library:|offer|seal|reopen)/;

/** pure — does this error belong to a view (shown in place), not the top of the window? */
export const isPlacedError = (at) => typeof at === 'string' && PLACED.test(at);

// ─── The being preview (Design note, 2026-10-01: […]) ──
// Cloning is zero-shot — the clip and its words ARE the voice — so the forge
// shows it happening: every found take is heard as the being at once.

const NO_PREVIEW = Object.freeze({ state: 'none', kind: null, error: null });

/**
 * A take's being-preview: `none` (not asked), `making`, `ready` (with its
 * kind: 'being', or 'recording' when the voice engine is not installed) or
 * `failed` (with the error). Pure.
 * @param {Object<string, object>} previews - by take ref
 * @param {string} ref
 */
export const beingPreviewOf = (previews, ref) => previews?.[ref] ?? NO_PREVIEW;

/**
 * The refs a find brought that still need their being-preview asked for —
 * not those already making or ready; a failed one is asked again. Pure.
 * @param {string[]} refs - the `found` refs of a find
 * @param {Object<string, object>} previews
 */
export const refsToPreview = (refs, previews) => [...new Set(refs ?? [])]
  .filter((ref) => !['making', 'ready'].includes(beingPreviewOf(previews, ref).state));
