// DeleteConfirm — the delete ask as a desk-level POPUP (Design note, 2026-08-16:
// […]) on the
// FolderOpenFlow pattern: body portal, dimmed overlay, centered cham dialog.
// Escape and the backdrop cancel; CANCEL takes focus so Enter never
// destroys; DELETE is always an explicit aimed click. The DON'T ASK AGAIN
// chip keeps its law — it binds only when the delete actually lands
// (FilesApp's doDelete gates the waiver on a clean landing).

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './DeleteConfirm.css';

// A bulk ask names what it takes, but a huge selection must not become a
// scroll test — the tail collapses to an honest count.
const MAX_NAMED = 8;

export const DeleteConfirm = ({ entries, noAsk, onNoAsk, onDelete, onCancel }) => {
  const cancelRef = useRef(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const single = entries.length === 1 ? entries[0] : null;
  return createPortal(
    <div className="delconfirm-overlay" onMouseDown={onCancel}>
      <div
        className="delconfirm cham"
        role="alertdialog"
        aria-modal="true"
        aria-label="Confirm delete"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="delconfirm-in cham-in">
          <p className="delconfirm-title label-data">
            {single
              ? `DELETE ${single.name}${single.type === 'dir' ? ' (folder + contents)' : ''}?`
              : `DELETE ${entries.length} ITEMS?`}
          </p>
          {single ? null : (
            <ul className="delconfirm-list">
              {entries.slice(0, MAX_NAMED).map((e) => (
                <li key={e.path} className="delconfirm-item label-data">
                  {e.name}{e.type === 'dir' ? ' (folder + contents)' : ''}
                </li>
              ))}
              {entries.length > MAX_NAMED
                ? <li className="delconfirm-item is-more label-data">+ {entries.length - MAX_NAMED} MORE</li>
                : null}
            </ul>
          )}
          <div className="delconfirm-row">
            <button
              type="button"
              className={`delconfirm-noask${noAsk ? ' is-on' : ''}`}
              aria-pressed={noAsk}
              title="Skip this confirmation from now on (Settings › GENERAL turns it back on)"
              onClick={onNoAsk}
            >
              DON’T ASK AGAIN
            </button>
            <button type="button" className="delconfirm-go" onClick={onDelete}>DELETE</button>
            <button type="button" className="delconfirm-x" ref={cancelRef} onClick={onCancel}>CANCEL</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
