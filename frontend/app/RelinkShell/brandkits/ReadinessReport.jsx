// ReadinessReport — the exact sentences a being is refused with.
//
// The rail and the per-field gap marks are for WORKING. This is for knowing
// what will actually happen: `GET /:brand` returns `report`, and
// brand-routes.js:80-83 says why it exists — […]
//
// Collapsed by default. It is a wall of text on purpose (the gate's refusal is
// written to be acted on, not skimmed), and a wall of text open by default is
// the thing this whole rebuild is undoing.
//
// It describes the SAVED kit, not the draft — the rail covers the draft. That
// difference is worth keeping: this is what a campaign would be told right now,
// which is a fact about disk, not about the editor.

import { useState } from 'react';

export const ReadinessReport = ({ report, stale }) => {
  const [open, setOpen] = useState(false);
  if (!report) return null;
  return (
    <div className="bk-report">
      <button
        type="button"
        className="bk-report-head label-data"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{open ? '▾' : '▸'} WHAT A BEING IS REFUSED</span>
      </button>
      {open ? (
        <>
          {stale ? (
            <p className="bk-note">
              This is the kit as SAVED. Your unsaved changes are not in it yet.
            </p>
          ) : null}
          <pre className="bk-report-text">{report}</pre>
        </>
      ) : null}
    </div>
  );
};
