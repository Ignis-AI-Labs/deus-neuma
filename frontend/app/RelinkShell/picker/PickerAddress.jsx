// PickerAddress — the FolderPicker's address bar. At rest it reads as a
// breadcrumb trail (every ancestor one click away); click the bar's open
// space and it becomes the typed path, Enter or GO to travel, Escape to
// return to the trail. The input is always mounted beneath the trail so a
// typed path and the crumbs are one control, never two.

import { useEffect, useRef, useState } from 'react';
import { pathCrumbs } from '../../../utils/path.js';
import { UpGlyph, HomeGlyph, EnterGlyph, ChevronGlyph } from './picker-glyphs.jsx';

/**
 * @param {{
 *   cwd: string|null, parent: string|null, home: string|null,
 *   draft: string, onDraft: (v: string) => void,
 *   onGo: (path: string) => void, onCancel: () => void,
 * }} props
 */
export const PickerAddress = ({ cwd, parent, home, draft, onDraft, onGo, onCancel }) => {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);
  const crumbs = pathCrumbs(cwd || '');

  // impure — a trip that lands (typed + GO, or any navigation) returns the
  // bar to the trail of where you now are.
  useEffect(() => {
    if (inputRef.current && document.activeElement === inputRef.current) inputRef.current.blur();
  }, [cwd]);

  const travel = () => {
    const target = draft.trim();
    if (target) onGo(target);
  };

  return (
    <div className="picker-bar">
      <button type="button" className="picker-nav" onClick={() => parent && onGo(parent)} disabled={!parent} title="Up one level" aria-label="Up one level"><UpGlyph /></button>
      <button type="button" className="picker-nav" onClick={() => home && onGo(home)} disabled={!home} title="Home" aria-label="Home"><HomeGlyph /></button>
      <div className={`picker-address${editing ? ' is-editing' : ''}`}>
        <input
          ref={inputRef}
          className="picker-pathinput"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onFocus={(e) => { setEditing(true); e.target.select(); }}
          onBlur={(e) => { e.target.setSelectionRange(0, 0); setEditing(false); onDraft(cwd || ''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { travel(); e.currentTarget.blur(); }
            if (e.key === 'Escape') {
              e.stopPropagation();
              if (draft !== (cwd || '')) onDraft(cwd || '');
              else onCancel();
              e.currentTarget.blur();
            }
          }}
          placeholder="/absolute/path"
          spellCheck={false}
          aria-label="Folder path"
        />
        {editing ? null : (
          <ol className="picker-crumbs" aria-label="Current folder">
            {crumbs.map((c, i) => (
              <li key={c.path} className="picker-crumb-item">
                {i > 1 ? <span className="picker-crumb-sep" aria-hidden="true"><ChevronGlyph /></span> : null}
                <button
                  type="button"
                  className={`picker-crumb${i === crumbs.length - 1 ? ' is-here' : ''}`}
                  onClick={() => onGo(c.path)}
                  title={c.path}
                >
                  {c.label}
                </button>
              </li>
            ))}
          </ol>
        )}
        {/* mousedown keeps focus in the input, so a typed path survives to the click */}
        <button type="button" className="picker-go" onMouseDown={(e) => e.preventDefault()} onClick={travel} title="Go to this path" aria-label="Go to this path">
          <EnterGlyph /><span className="picker-go-label">GO</span>
        </button>
      </div>
    </div>
  );
};
