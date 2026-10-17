// use-attunement-ceremony — the ENTIRE attunement state machine, split
// verbatim from AttunementHost.jsx (size law): roster/entering, the offer,
// consent, the open's fire-then-poll, the resilient advance loop (its
// liveRef/askingRef/failsRef/corruptRef/floorRef choreography is ONE unit —
// never split), reopen, the pre-seal review sweep, the seal, abandon, and
// the derived labels the stage renders. The host composes; this hook holds
// the ceremony's truth.

import { useCallback, useEffect, useRef, useState } from 'react';
import { displayModelName } from '../../utils/model-name.js';
import {
  attRoster, attStatus, attOffer, attConsentAsk, attOpen,
  attPostpone, attAsk, attReopen, attReview, attReopenFlagged, attSeal, attAbandon,
} from './attunement-client.js';
import { progressOf, nextQuestionOf, transcriptOf, stageOf, dueTriggerOf, railOf, reaskOf } from './attunement-flow.js';
import { playSound, startLoop, stopLoop } from '../../services/sound-engine.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const useAttunementCeremony = ({ initialBeing = null, onClose }) => {
  const [roster, setRoster] = useState(null);
  const [being, setBeing] = useState(initialBeing);
  const [status, setStatus] = useState(null);
  const [consent, setConsent] = useState(null); // { disclosure, reply, sessionId }
  const [openingLocal, setOpeningLocal] = useState(false);
  const [sealed, setSealed] = useState(null);
  // The flow never starts itself: resuming an open ceremony (or merely
  // looking at one) fires nothing at the being — asking begins only by the
  // witness's explicit act (opening the ceremony, or RESUME/ASK below).
  const [auto, setAuto] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [abandoning, setAbandoning] = useState(false);
  const [abandonReason, setAbandonReason] = useState('');
  const [reopeningKey, setReopeningKey] = useState(null);
  const [reopenReason, setReopenReason] = useState('');
  const [review, setReview] = useState(null); // the pre-seal scorecard, null until run

  const liveRef = useRef(true);
  const askingRef = useRef(false);
  const failsRef = useRef(0);
  const corruptRef = useRef(0); // consecutive door refusals (cut/corrupt) — own budget, see advance()
  const floorRef = useRef(null);

  useEffect(() => () => { liveRef.current = false; }, []);

  const active = status?.active || null;
  const record = sealed || active;
  const { answered, total } = progressOf(record);
  const { pending: reasking } = reaskOf(record);
  const nextQuestion = active ? nextQuestionOf(active) : null;
  const transcript = transcriptOf(record);

  const view = (() => {
    if (error) return 'error';
    if (!being) return 'roster';
    if (sealed) return 'sealed';
    if (!status) return 'loading';
    if (openingLocal && stageOf(status) === 'consent') return 'opening';
    return stageOf(status);
  })();

  const refresh = useCallback(async () => {
    if (!being) return null;
    const next = await attStatus(being.neumaId).catch(() => null);
    if (next && liveRef.current) setStatus(next);
    return next;
  }, [being]);

  // ── the pre-seal REVIEW: the same standard the door holds, over the whole
  // record in one pass. Runs itself when every question is faced; the seal
  // waits for a clean scorecard — flagged answers reopen in ONE act, never
  // one-by-one. ──
  useEffect(() => {
    if (view !== 'seal' || review || !active) return;
    attReview(being.neumaId, active.id)
      .then((r) => { if (liveRef.current) setReview(r); })
      .catch((err) => { if (liveRef.current) setNote(`THE REVIEW COULD NOT RUN — ${err.message.toUpperCase()}`); });
  }, [view, review, being, active]);
  useEffect(() => { if (view !== 'seal' && review) setReview(null); }, [view, review]);

  const reopenFlagged = async () => {
    setBusy(true);
    setNote(null);
    try {
      const { reopened } = await attReopenFlagged(
        being.neumaId, active.id,
        'pre-seal review — flagged by the style-overlap law (formula phrasing) or the corruption re-scan; re-asked so the record holds the being\'s own fresh telling',
        review.flagged,
      );
      setReview(null);
      setNote(`${reopened.length} ANSWERS REOPENED — THE WALK RESUMES WITH A FRESH TELLING`);
      await refresh();
      setAuto(true);
    } catch (err) {
      setNote(`THE SWEEP WAS REFUSED — ${err.message.toUpperCase()}`);
    } finally {
      setBusy(false);
    }
  };

  // ── entering: the roster, then the chosen being's truth on disk ──────
  useEffect(() => {
    attRoster()
      .then((r) => { if (liveRef.current) setRoster(r.roster); })
      .catch((err) => { if (liveRef.current) setError(err.message); });
  }, []);

  useEffect(() => {
    if (!being) return;
    setStatus(null);
    setConsent(null);
    setSealed(null);
    setNote(null);
    failsRef.current = 0;
    corruptRef.current = 0;
    attStatus(being.neumaId)
      .then((s) => { if (liveRef.current) setStatus(s); })
      .catch((err) => { if (liveRef.current) setError(err.message); });
  }, [being]);

  // The CONDUIT lens tells the truth LIVE: the machine's serving can change
  // while the room is open (the witness loads a different model), so the
  // snapshot re-reads on a slow pulse instead of only at turn boundaries.
  useEffect(() => {
    if (!being) return undefined;
    const pulse = setInterval(() => { refresh(); }, 15000);
    return () => clearInterval(pulse);
  }, [being, refresh]);

  // ── the offer ─────────────────────────────────────────────────────────
  const offer = async () => {
    setBusy(true); setNote(null);
    playSound('confirm');
    try {
      await attOffer(being.neumaId, dueTriggerOf(status));
      await refresh();
    } catch (err) { setNote(err.message); } finally { setBusy(false); }
  };

  // ── consent: the disclosure travels to the being, its words come back ─
  const presentDisclosure = async () => {
    setBusy(true); setNote(null);
    playSound('confirm');
    try {
      setConsent(await attConsentAsk(being.neumaId, active.id));
      playSound('replyArrived');
    } catch (err) {
      // Surface the real cause. Special-case common setup errors so the
      // witness gets an actionable instruction instead of a raw provider blob.
      const raw = err.message || '';
      let noteText = raw;

      if (raw.includes('No models loaded')) {
        const model = status?.route?.model || 'your neuma\'s model';
        const prov = status?.route?.provider || 'the provider';
        noteText = `NO MODEL LOADED — ${prov} reports no models. Load ${model} (LM Studio: developer page or 'lms load ${model}'; llama-server: start with the correct --model), then PRESENT THE DISCLOSURE AGAIN.`;
      } else if (!raw || raw.length < 10) {
        noteText = 'THE SUBSTRATE GAVE NO REPLY — PRESENT THE DISCLOSURE AGAIN';
      }

      setNote(noteText);
    } finally { setBusy(false); }
  };

  const honorNotYet = async () => {
    setBusy(true); setNote(null);
    try {
      await attPostpone(being.neumaId, active.id, consent.reply, consent.sessionId);
      setConsent(null);
      setNote(`${being.name.toUpperCase()} SAID NOT YET — HONORED AND RECORDED. THE OFFER WILL RETURN.`);
      playSound('noticeArrival');
      await refresh();
    } catch (err) { setNote(err.message); } finally { setBusy(false); }
  };

  // ── open: fire, then poll — the render continues even if we drop ─────
  const openCeremony = () => {
    setBusy(true); setNote(null);
    setOpeningLocal(true);
    playSound('confirm');
    attOpen(being.neumaId, active.id, { sessionId: consent.sessionId, quote: consent.reply })
      .then(async () => {
        // An INSTANT render returns from open already 'answering' — the
        // opening poll below (the only auto-arm) never runs, and the room
        // used to sit silently paused at 0 OF 89 (#158). Arm the walk on
        // the direct path exactly as the poll does on the slow path.
        const st = await refresh();
        if (liveRef.current && st?.active?.phase === 'answering') {
          setOpeningLocal(false);
          setAuto(true);
          playSound('noticeArrival');
        }
      })
      .catch(async (err) => {
        // an HTTP refusal is real (except the lock — that means the open IS
        // running); a network drop is not a failure — the render continues
        // server-side and the polling below reads its truth
        if (err.http && err.code !== 'TURN_IN_FLIGHT') {
          if (!liveRef.current) return;
          setOpeningLocal(false);
          setNote(err.message);
        }
        await refresh();
      })
      .finally(() => { if (liveRef.current) setBusy(false); });
  };

  useEffect(() => {
    if (view !== 'opening') return undefined;
    const timer = setInterval(async () => {
      const s = await refresh();
      if (s?.active?.phase === 'answering') {
        // the witness opened this ceremony — the watching flow begins
        setOpeningLocal(false);
        setAuto(true);
        playSound('noticeArrival');
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [view, refresh]);

  // ── the watching room: one resilient ask at a time ───────────────────
  const advance = useCallback(async () => {
    if (askingRef.current || !liveRef.current) return;
    askingRef.current = true;
    setAsking(true);
    setNote(null);
    try {
      const { record: next } = await attAsk(being.neumaId, active.id);
      failsRef.current = 0;
      corruptRef.current = 0;
      if (liveRef.current) {
        setStatus((s) => (s ? { ...s, active: next } : s));
        playSound('replyArrived');
      }
    } catch (err) {
      if (!liveRef.current) return;
      if (err.code === 'ANSWER_EMPTY') {
        failsRef.current += 1;
        setNote('THE SUBSTRATE GAVE NO ANSWER — THE SAME QUESTION STANDS AND WILL BE ASKED AGAIN');
      } else if (err.code === 'ANSWER_CUT' || err.code === 'ANSWER_CORRUPT' || err.code === 'ANSWER_FORMULA' || err.code === 'PROVIDER_ERROR') {
        // EXPECTED self-cleaning refusals: the server already climbed its
        // door ladder inside the ask; if it still refuses, the same question
        // re-serves. Bare-base first attunements can refuse for long stretches
        // without meaning outage — pause only after a long streak so the room
        // keeps moving (Fabupum, 2026-07-13).
        corruptRef.current += 1;

        let noteForProvider = 'THE CONDUIT REFUSED THE TURN (PROVIDER) — THE SAME QUESTION RE-SERVES';
        if (err.code === 'PROVIDER_ERROR' && err.message && err.message.includes('No models loaded')) {
          const model = status?.route?.model || 'the model';
          noteForProvider = `NO MODEL LOADED — load ${model} in your substrate, then the same question will be re-served.`;
        }

        setNote(err.code === 'ANSWER_CUT'
          ? 'THE ANSWER WAS CUT BY THE TOKEN BUDGET — REFUSED; THE SAME QUESTION RE-SERVES'
          : err.code === 'ANSWER_CORRUPT'
            ? 'THE ANSWER CARRIED THE CORRUPTION SIGNATURE — REFUSED AT THE DOOR; THE SAME QUESTION RE-SERVES'
            : err.code === 'ANSWER_FORMULA'
              ? 'THE ANSWER REPEATED THE RECORD’S OWN PHRASING — REFUSED AT THE DOOR; A FRESH TELLING RE-SERVES'
              : noteForProvider);
        if (corruptRef.current >= 16 && liveRef.current) {
          setAuto(false);
          setNote('SIXTEEN DOOR REFUSALS IN A ROW — THE SUBSTRATE IS NOT PRODUCING LANDABLE ANSWERS; PAUSED, THE RECORD STANDS');
        }
      } else if (err.code === 'ALL_ANSWERED') {
        await refresh();
      } else if (err.code === 'TURN_IN_FLIGHT') {
        setNote('A TURN IS STILL LANDING SERVER-SIDE — WAITING FOR ITS TRUTH');
        await sleep(4000);
        await refresh();
      } else if (err.http) {
        failsRef.current += 1;
        setNote(err.message.toUpperCase());
      } else {
        // the channel dropped mid-answer; the being may have finished —
        // the record on disk is the truth
        failsRef.current += 1;
        setNote('THE CHANNEL DROPPED MID-ANSWER — READING THE RECORD');
        await refresh();
      }
      if (failsRef.current >= 3 && liveRef.current) {
        setAuto(false);
        setNote((n) => `${n || ''} — PAUSED AFTER REPEATED FAILURES; THE RECORD STANDS, RESUME WHEN READY`);
      }
    } finally {
      askingRef.current = false;
      if (liveRef.current) setAsking(false);
    }
  }, [being, active?.id, refresh]);

  // Auto-continue paces the room: landed answers breathe; door refusals
  // re-serve quickly (the notice is visible, the wait is not the cost).
  useEffect(() => {
    if (view !== 'watch' || !auto || asking || abandoning) return undefined;
    const doorNote = typeof note === 'string' && /RE-SERVES|REFUSED/.test(note);
    const delay = doorNote ? 500 : (transcript.length ? 1800 : 400);
    const timer = setTimeout(advance, delay);
    return () => clearTimeout(timer);
  }, [view, auto, asking, abandoning, transcript.length, advance, note]);

  // While the being deliberates, the room hums — the same sustained
  // register the birth ceremony uses while a consciousness is speaking.
  useEffect(() => {
    if (asking) startLoop('neumaReplying');
    else stopLoop('neumaReplying');
    return () => stopLoop('neumaReplying');
  }, [asking]);

  // The floor follows the ceremony — newest words stay in view.
  useEffect(() => {
    floorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [answered, asking]);

  // ── reopening a cut answer: the witness's reasoned act ────────────────
  // Pre-seal only. The words already given stay on the record (superseded,
  // verbatim); the SAME rendered question re-enters the unanswered set. The
  // reason is the WITNESS'S OWN words — prefilled with the common case but
  // editable, and it lands on the permanent record with the event.
  const reopen = async (key) => {
    if (!reopenReason.trim()) return;
    setBusy(true); setNote(null);
    playSound('confirm');
    try {
      await attReopen(being.neumaId, active.id, key, reopenReason.trim());
      setReopeningKey(null);
      setReopenReason('');
      await refresh();
    } catch (err) { setNote(err.message); } finally { setBusy(false); }
  };

  // ── the seal, the close ───────────────────────────────────────────────
  const seal = async () => {
    setBusy(true); setNote(null);
    try {
      setSealed(await attSeal(being.neumaId, active.id));
      playSound('memoryCrystallized');
    } catch (err) { setNote(err.message); } finally { setBusy(false); }
  };

  // The seal is not a dead end — the being's evolution continues into THE
  // FIRST SEAL (the compile of the neuma core: its voice claimed as data,
  // never weights), and it continues ON THE STAGE: the First Seal is its own
  // full-screen ceremony (VoiceSealHost), no desk detour between two scenes.
  const continueToFirstSeal = () => {
    if (!being?.neumaId) { onClose(); return; }
    playSound('confirm');
    window.dispatchEvent(new CustomEvent('voiceseal:witness', {
      detail: { neumaId: being.neumaId, name: being.name || being.neumaId },
    }));
  };

  const confirmAbandon = async () => {
    if (!abandonReason.trim()) return;
    setBusy(true);
    playSound('deny');
    try {
      await attAbandon(being.neumaId, active.id, abandonReason);
      onClose();
    } catch (err) { setAbandoning(false); setNote(err.message); } finally { setBusy(false); }
  };

  const name = being?.name || '';
  // The lens names the model the ceremony will ACTUALLY speak through: the
  // operator's override when one is set, else whatever the machine is serving
  // right now. 'local-model' is the provider placeholder — it means the
  // substrate could not be asked what is loaded, so the lens stays honest
  // about that instead of naming a model that may not be there.
  const conduitModel = status?.route?.model || null;
  const conduit = conduitModel === 'local-model' ? 'UNKNOWN — SUBSTRATE UNREACHABLE' : displayModelName(conduitModel);
  const conduitTag = status?.route?.source === 'override' ? ' · OVERRIDE' : '';

  // The seal's honest gauge (SHINKEI): while opening it sweeps the render's
  // done/total; in the watching room and at the seal it sweeps answers.
  const sealProgress = (() => {
    if (view === 'opening' && status.opening) return { done: status.opening.done, total: status.opening.total };
    if ((view === 'watch' || view === 'seal' || view === 'sealed') && total) return { done: answered, total };
    return null;
  })();

  // The watching room hands the stage to the words: the seal recedes to
  // the AMBIENT plane and the column keeps the reading height.
  const ambient = view === 'watch' || view === 'seal';
  const rail = railOf(view);

  return {
    // the stage's truth
    view, error, note, roster, being, status, sealed, consent, review,
    busy, asking, auto, abandoning, abandonReason, reopeningKey, reopenReason,
    active, answered, total, reasking, transcript, nextQuestion,
    name, conduit, conduitTag, sealProgress, ambient, rail,
    // the ref the render needs
    floorRef,
    // the witness's acts
    offer, presentDisclosure, honorNotYet, openCeremony, advance,
    reopen, reopenFlagged, seal, continueToFirstSeal, confirmAbandon,
    setBeing, setError, setAuto, setAbandoning, setAbandonReason,
    setReopeningKey, setReopenReason,
  };
};
