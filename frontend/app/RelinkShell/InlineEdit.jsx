// InlineEdit — an earlier message rewritten where it stands (StreamPanel's MessageView), with the voice the composer
// has (Design note, 2026-11-19: […]). The composer's hold-Space lane
// (use-hold-to-talk.js) answers Space only outside typing fields and inside its own; this field gets the same lane for
// itself: a tap is a space, a HOLD dictates into the edit at the caret, release transcribes. Mounted only while editing.

import { useEffect } from 'react';
import { useHoldToTalk } from './use-hold-to-talk.js';
import { uiSound } from '../../services/ui-sound.js';

const MIC_WORDS = Object.freeze({ recording: 'LISTENING — RELEASE TO TRANSCRIBE', transcribing: 'TRANSCRIBING…', error: 'THE MICROPHONE COULD NOT BE USED' });

export const InlineEdit = ({ message, draft, setDraft, fieldRef, actionsRef, spokenText, onSave, onCancel }) => {
  // Its own recorder, its own field; the window-wide Space stays the composer's (one recorder per hold).
  const { mic, onFieldKeyDown } = useHoldToTalk({ connected: true, setValue: setDraft, fieldRef, windowLane: false });
  // EDIT puts the caret in the box, as it always has — once, when the box opens.
  useEffect(() => { fieldRef.current?.focus(); }, [fieldRef]);
  return (
    <div className={`relink-inline-edit${mic === 'recording' ? ' is-listening' : ''}`}>
      <textarea
        ref={fieldRef}
        className="relink-inline-edit-field"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Space belongs to dictation first (a tap types it; a hold talks).
          if (onFieldKeyDown(e)) return;
          // Escape stands the editor down (and never walks the field's own Escape ladder); ⌘/Ctrl+Enter saves.
          if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave(); }
        }}
      />
      <div ref={actionsRef} className="relink-inline-edit-actions label-data">
        {MIC_WORDS[mic] ? <span className="relink-inline-mic" role="status" data-mic={mic}>{MIC_WORDS[mic]}</span> : null}
        <button
          type="button"
          className="relink-inline-save"
          disabled={!draft.trim() || draft === spokenText}
          title={message.queued
            ? 'Rewrite the held word — it still goes after the current action finishes'
            : message.turnId
              ? 'Send the revised words from this point — the conversation continues from here'
              : 'This message carries no point — the words go to the composer instead'}
          onClick={onSave}
        >
          {message.queued ? 'SAVE — STILL QUEUED' : 'SAVE — CONTINUE FROM HERE'}
        </button>
        <button type="button" className="relink-inline-cancel" onClick={() => { uiSound('tick'); onCancel(); }}>CANCEL</button>
      </div>
    </div>
  );
};
