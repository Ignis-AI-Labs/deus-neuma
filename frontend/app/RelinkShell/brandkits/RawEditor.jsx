// RawEditor — the whole kit as JSON, kept for the cases a form is worse.
//
// It used to be the ONLY way to reach twenty of the thirty-nine gated fields.
// It is not that any more — every field has a control — so it has moved from
// the bottom of the panel to its own rail entry, where it is a tool rather than
// a confession.
//
// It stays because two things a form is genuinely bad at still matter: pasting
// a kit somebody sent you, and seeing all of it at once to compare against
// another. The structured edits and this text stay in lockstep either way.

import { useKit } from './kit-context.js';

export const RawEditor = () => {
  const { raw, rawError, editRaw } = useKit();
  return (
    <div className="bk-section">
      <header className="bk-section-head">
        <h4 className="label-data">THE WHOLE KIT</h4>
        <p className="bk-note">
          Every field has a control of its own now. This is here for pasting a
          kit in whole, or reading one at a glance.
        </p>
      </header>
      <label className="bk-field bk-raw">
        <textarea
          value={raw}
          spellCheck="false"
          onChange={(e) => editRaw(e.target.value)}
          rows={28}
          aria-label="the whole brand kit as JSON"
        />
      </label>
      {rawError ? <p className="bk-error">{rawError}</p> : null}
    </div>
  );
};
