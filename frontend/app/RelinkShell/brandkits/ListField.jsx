// ListField — a list with THREE states, because the gate reads three.
//
//   absent   nobody has looked at this yet
//   []       somebody looked and decided there are none
//   entries  the answers
//
// The middle one is the whole reason this control is not a textarea. From
// kit-readiness.js: […]
//
// ⚠️ WHICH STATES EXIST DEPENDS ON THE FIELD, and the spec says which. `list`
// fields (disclosures, imagery.avoid, competitors.neverName) accept `[]`.
// `list1` fields (pillars, bannedPatterns, claims.approved, claims.forbidden)
// do NOT — a brand with no pillars and no approved claims is not a brand
// somebody decided about. So THERE ARE NONE is offered only where it is a real
// answer. Offering it everywhere would be a one-click way to look decided while
// still failing the gate, which is worse than not offering it at all.

import { useState } from 'react';
import { FieldLabel } from './FieldControls.jsx';

export const ListField = ({ field, value, onChange, onUnset, gap }) => {
  const [typed, setTyped] = useState('');
  const rows = Array.isArray(value) ? value : null;
  const emptyIsAnswer = field.kind === 'list';

  const commit = () => {
    const entry = typed.trim();
    if (!entry) return;
    onChange(field.path, [...(rows || []), entry]);
    setTyped('');
  };

  return (
    <div className="bk-field bk-field-wide bk-list">
      <FieldLabel field={field} gap={gap} />

      {rows === null ? (
        <p className="bk-list-none label-data">
          NOT DECIDED
          {emptyIsAnswer ? (
            <button type="button" className="bk-list-decide" onClick={() => onChange(field.path, [])}>
              THERE ARE NONE
            </button>
          ) : null}
        </p>
      ) : null}

      {rows && rows.length === 0 ? (
        <p className="bk-list-none label-data">
          NONE — decided
          <button type="button" className="bk-list-decide" onClick={() => onUnset(field.path)}>
            UNDO
          </button>
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <ul className="bk-list-rows">
          {rows.map((entry, i) => (
            // Index-keyed deliberately: entries are free text and two identical
            // lines are legitimate, so the value cannot be the key.
            <li key={`${i}-${entry}`}>
              <input
                type="text"
                value={entry}
                onChange={(e) => {
                  const next = rows.slice();
                  next[i] = e.target.value;
                  onChange(field.path, next);
                }}
              />
              <button
                type="button"
                className="bk-list-del"
                aria-label={`remove "${entry}"`}
                onClick={() => onChange(field.path, rows.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <span className="bk-list-add">
        <input
          type="text"
          value={typed}
          placeholder={field.placeholder || 'add one'}
          onChange={(e) => setTyped(e.target.value)}
          // Enter commits, because typing a list means typing several things in
          // a row and reaching for the mouse between each is the whole friction.
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          // ...and blur commits too, so a line typed and then clicked away from
          // is not silently discarded.
          onBlur={commit}
        />
        <button type="button" onClick={commit} disabled={!typed.trim()}>ADD</button>
      </span>
    </div>
  );
};
