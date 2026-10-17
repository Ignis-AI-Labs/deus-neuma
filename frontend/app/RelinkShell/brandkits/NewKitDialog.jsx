// NewKitDialog — naming a new brand, in the house's own modal.
//
// Replaces `window.prompt()`. A native prompt cannot be styled, cannot say what
// a valid name is until after you have got it wrong, blocks the whole renderer,
// and looks like a browser alert in the middle of a desk. The shape here is
// files/DeleteConfirm.jsx's: a body portal, a dimmed overlay, a chamfered
// dialog, Escape and backdrop to cancel.
//
// The name is validated AS IT IS TYPED against the same rule the server holds
// it to, so "Acme Corp" is refused here with the reason rather than by a 400
// after the fact.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** The identity law every name that reaches disk crosses — SAFE_NAME on the
 *  server, restated here only to say NO sooner and with a reason. */
const SAFE_NAME = /^[a-z][a-z0-9-]{0,39}$/;

export const NewKitDialog = ({ onCancel, onCreate }) => {
  const [name, setName] = useState('');
  const cancelRef = useRef(null);
  const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
  const ok = SAFE_NAME.test(slug);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return createPortal(
    <div className="bk-modal-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bk-modal cham" role="dialog" aria-modal="true" aria-label="new brand kit">
        <div className="cham-in">
          <h4 className="label-data">A NEW BRAND KIT</h4>
          <p className="bk-note">
            A kit is the standing instruction for what a company says and never
            says. It is set up once, before the marketing work.
          </p>
          <label className="bk-field">
            <span className="label-data">SHORT NAME</span>
            <input
              type="text"
              value={name}
              autoFocus
              spellCheck="false"
              placeholder="acme"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && ok) onCreate(slug); }}
            />
          </label>
          <p className={`bk-modal-hint label-data${name && !ok ? ' is-bad' : ''}`}>
            {name
              ? (ok ? `WILL BE SAVED AS "${slug}"` : 'LOWERCASE LETTERS, DIGITS AND HYPHENS — STARTING WITH A LETTER')
              : 'LOWERCASE LETTERS, DIGITS AND HYPHENS'}
          </p>
          <div className="bk-modal-acts">
            <button type="button" ref={cancelRef} onClick={onCancel}>CANCEL</button>
            <button type="button" className="is-go" disabled={!ok} onClick={() => onCreate(slug)}>CREATE</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
