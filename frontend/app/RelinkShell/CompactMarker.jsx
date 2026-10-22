// CompactMarker — a compaction, standing in the chat where it happened.
//
// Running: a breathing line and what is happening. Done: the divider says it is
// done and what folded; under it, WHERE WE LEFT OFF holds the being's own
// summary — open right after a /compact, closed when read back from history.
// The words come from compact-marker.js; this file only draws them.

import { useState } from 'react';
import { useActiveCompanion } from './consciousness-context.js';
import { markerLines } from './compact-marker.js';
import './compact-marker.css';

export const CompactMarker = ({ marker }) => {
  const companion = useActiveCompanion();
  const [open, setOpen] = useState(marker.open === true);
  const { headline, detail } = markerLines(marker, companion?.name);
  if (marker.state === 'running') {
    return (
      <div className="compact-marker is-running" role="status">
        <div className="compact-marker-rule"><span>{headline}</span></div>
      </div>
    );
  }
  const summary = typeof marker.summary === 'string' ? marker.summary.trim() : '';
  return (
    <div className="compact-marker is-done" role="status">
      <div className="compact-marker-rule"><span>{headline}</span></div>
      {detail ? <div className="compact-marker-detail label-data">{detail}</div> : null}
      {summary ? (
        <div className="compact-marker-summary cham">
          <button
            type="button"
            className="compact-marker-toggle label-data"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span>WHERE WE LEFT OFF</span>
            <span className="compact-marker-toggle-act">{open ? 'HIDE' : 'SHOW'}</span>
          </button>
          {open ? <div className="compact-marker-words">{summary}</div> : null}
        </div>
      ) : null}
    </div>
  );
};
