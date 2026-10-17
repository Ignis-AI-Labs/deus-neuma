// PresetGallery — the FR-3 preset gallery extracted verbatim from
// VoiceApp.jsx (size-law breakdown, 2026-08-26). Pure presentation over
// server preset data; the audition chip shares VoicePlayer's PlayIcon.
// This module never imports VoiceApp.jsx.

import { groupPresetsByEngine } from './voice-presets.js';
import { PlayIcon } from './VoicePlayer.jsx';

// The preset gallery (FR-3) — replaces both free-text voiceId inputs. One
// click on a card's body selects the preset; the play chip auditions it. All
// preset data is server data rendered as text children only (Rule 8). Audition
// runs at BOTH stages: offering-stage plays through the one-off
// /engines/local/:id/audition route (the preset's own engine, nothing
// recorded); iterate-stage plays through the session's forge preview (the
// candidate applied — the preview route is valid at ITERATING only).
export const PresetGallery = ({ presets, selectedId, onSelect, onAudition, auditioningId, canAudition }) => {
  if (!presets.length) {
    return <p className="voice-field-note">No presets available — the gallery manifest did not load.</p>;
  }
  return (
    <div className="preset-gallery">
      {groupPresetsByEngine(presets).map((section) => (
        <div key={section.engine} className="preset-engine-group">
          <span className="label-data preset-engine-h">{section.engineName}</span>
          <div className="preset-grid">
            {section.presets.map((p) => (
              <div key={p.id} className="preset-card" data-selected={p.id === selectedId || undefined}>
                <button type="button" className="preset-card-main" onClick={() => onSelect(p.id)}>
                  <span className="preset-card-name">{p.name}</span>
                  <span className="preset-card-badges">
                    <span className="label-data preset-badge">{p.engineName}</span>
                    <span className="label-data preset-badge preset-badge-license">{p.license}</span>
                  </span>
                </button>
                {canAudition && (
                  <button
                    type="button"
                    className="preset-audition"
                    onClick={() => onAudition(p.id)}
                    disabled={auditioningId != null}
                    aria-label={`Audition ${p.name}`}
                  >
                    {auditioningId === p.id ? '…' : <PlayIcon />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
