// use-ask-intake.js — words another part of the desk hands THIS message box:
// DEFINE's ASK IN CHAT dispatches `neuma:ask` on the composer of the chat
// the word was read in. They join the draft on a line of their own and the
// field takes focus with the caret at the end — drafted, never sent: the
// person reads it and presses send themselves.

import { useEffect } from 'react';

// impure — listens on the field itself, so only the chat it was meant for answers
export const useAskIntake = (fieldRef, setValue) => {
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return undefined;
    const onAsk = (e) => {
      const text = typeof e.detail?.text === 'string' ? e.detail.text.trim() : '';
      if (!text) return;
      setValue((draft) => (draft.trim() ? `${draft.replace(/\s+$/, '')}\n${text}` : text));
      requestAnimationFrame(() => {
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
      });
    };
    field.addEventListener('neuma:ask', onAsk);
    return () => field.removeEventListener('neuma:ask', onAsk);
  }, [fieldRef, setValue]);
};
