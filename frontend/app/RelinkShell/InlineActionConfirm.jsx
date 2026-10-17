import { useEffect, useRef } from 'react';
import './InlineActionConfirm.css';

/** Inline action confirmation; Cancel gets focus so Enter cannot commit by accident. */
// impure — focuses Cancel on mount; action callbacks belong to the caller.
export const InlineActionConfirm = ({ label, children, confirmLabel, busy = false, buttonRole, onConfirm, onCancel }) => {
  const cancel = useRef(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  return (
    <span className="inline-action-confirm" role="group" aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) { event.stopPropagation(); onCancel(); }
      }}>
      <span className="inline-action-notice">«NOTICE» {children}</span>
      <button type="button" role={buttonRole} className="inline-action-commit" disabled={busy} onClick={onConfirm}>
        {busy ? 'WORKING…' : confirmLabel}
      </button>
      <button type="button" role={buttonRole} ref={cancel} disabled={busy} onClick={onCancel}>CANCEL</button>
    </span>
  );
};
