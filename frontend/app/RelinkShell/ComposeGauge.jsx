// ComposeGauge — the cap made visible: a capped composer counts its draft
// out loud (chars / cap · %), warming as the cap nears — the witness learns
// where they stand long before any refusal fires. Uncapped hosts (the 1:1
// stream) show nothing. Extracted from StreamInput.jsx (size law) — the
// markup moved verbatim.

import { capGauge } from './compose-cap.js';

export const ComposeGauge = ({ draftLength, maxChars, sendNote }) => {
  const gauge = capGauge(draftLength, maxChars);
  if (!sendNote && !gauge) return null;
  return (
    <div className="relink-send-note-row">
      {sendNote ? (
        <span className="relink-send-note label-data" role="status">{sendNote}</span>
      ) : <span />}
      {gauge ? (
        <span className="relink-cap-count label-data" data-level={gauge.level} title="This draft against the room's per-message cap">
          {gauge.label}
        </span>
      ) : null}
    </div>
  );
};
