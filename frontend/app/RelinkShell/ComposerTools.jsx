// ComposerTools.jsx — the composer's TALK (the chat's voice sitting) and its REFINE action.
//
// REFINE (Design note, 2026-10-10: […]): one press shapes the draft — punctuation, sentences, paragraphs,
// […]/[…] gone — on this machine's own model, every other word kept
// (core/text/refine.js guards it server-side). Never automatic: the composer
// never silently rewrites the operator. The draft it replaced stays one press
// away (UNDO) until the operator edits the refined text.
//
// The LIVE toggle that sat here left 2026-11-13 (Founder: one place for voice, the chat's TALK beside
// the mic; ChatApp.jsx).

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCall } from '../../utils/http.js';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { useConsciousnessPick } from './consciousness-context.js';
import { talkToggleModel } from './VoiceSitting/voice-sitting-model.js';

const REFINE_NOTE_MS = 3500;

// THE TALK (Design note, 2026-08-01: […]).
//
// One button, one gesture. Work is not a mode you select — it is the desk as
// it stands. TALK opens the sitting (purpose conversation, VOX on, LIVE armed,
// the composer steps aside); EXIT or Escape puts the desk back. The backend's
// purpose law is untouched: this is still just which of the two purposes gets
// declared.
//
// ONE PLACE (Design note, 2026-11-13: […]): TALK sits in the composer beside the mic that dictates.
// It was a header toggle, with the composer's own LIVE open-mic beside the
// chat — two voice buttons that did nearly the same thing. LIVE is gone; the
// header has no voice button.
export const TalkButton = () => {
  const { voiceSittingActive, enterVoiceSitting, exitVoiceSitting } = useConsciousnessPick('voiceSittingActive', 'enterVoiceSitting', 'exitVoiceSitting');
  const { t } = useTranslation('desk');
  const model = talkToggleModel(voiceSittingActive);
  return (
    <button
      type="button"
      className={`relink-talk${model.live ? ' is-on' : ''}`}
      aria-pressed={model.live}
      title={t(`stream.${model.titleKey}`)}
      onClick={() => {
        uiSound('toggle');
        if (model.live) exitVoiceSitting(); else enterVoiceSitting();
      }}
    >
      {t(`stream.${model.labelKey}`)}
    </button>
  );
};


/**
 * The REFINE action over the composer draft.
 * @returns {{ state: 'idle'|'refining'|'refined'|'kept'|'error', refine: () => void, undo: () => void, canUndo: boolean }}
 */
export const useRefineDraft = ({ value, setValue, fieldRef, neumaId }) => {
  const [state, setState] = useState('idle');
  const undoRef = useRef(null); // { before, after } while the refined draft stands untouched
  const noteTimer = useRef(null);
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  // An edit to the refined text retires UNDO — the operator took it from there.
  useEffect(() => {
    if (undoRef.current && value !== undoRef.current.after) {
      undoRef.current = null;
      setState((s) => (s === 'refined' ? 'idle' : s));
    }
  }, [value]);

  const note = (next) => {
    setState(next);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setState((s) => (s === next ? 'idle' : s)), REFINE_NOTE_MS);
  };

  const refine = useCallback(async () => {
    const before = value;
    if (!before.trim() || state === 'refining') return;
    setState('refining');
    try {
      const res = await apiCall('POST', '/api/v1/voice/refine', { body: { text: before, neumaId } });
      if (fieldRef.current && fieldRef.current.value !== before) { setState('idle'); return; } // typed meanwhile
      if (!res?.refined) { note('kept'); return; }
      undoRef.current = { before, after: res.text };
      setValue(res.text);
      setState('refined');
      fieldRef.current?.focus();
    } catch {
      note('error');
    }
  }, [value, state, neumaId, setValue, fieldRef]);

  const undo = useCallback(() => {
    if (!undoRef.current) return;
    const { before } = undoRef.current;
    undoRef.current = null;
    setValue(before);
    setState('idle');
    fieldRef.current?.focus();
  }, [setValue, fieldRef]);

  return { state, refine, undo, canUndo: state === 'refined' && undoRef.current !== null };
};

const REFINE_LABEL = { idle: 'REFINE', refining: 'REFINING…', refined: 'UNDO', kept: 'KEPT', error: 'NO MODEL' };
const REFINE_HINT = {
  idle: 'Refine the draft: punctuation, sentences, paragraphs — every word kept',
  refining: 'Shaping the draft on this machine…',
  refined: 'Undo the refine — back to the words as spoken',
  kept: 'Left as spoken — refining would have changed your words',
  error: "Refine needs this machine's model running",
};

export const RefineButton = ({ state, refine, undo, canUndo, disabled }) => (
  <button
    type="button"
    className={`relink-refine is-${state}`}
    disabled={disabled || state === 'refining'}
    aria-label={REFINE_HINT[state]}
    title={REFINE_HINT[state]}
    onClick={() => { uiSound('tick'); if (canUndo) undo(); else refine(); }}
  >
    {REFINE_LABEL[state]}
  </button>
);
