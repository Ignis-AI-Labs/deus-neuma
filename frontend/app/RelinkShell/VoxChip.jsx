// VoxChip — the neuma's spoken voice, toggled where the operator's eyes
// already are: the composer row (moved down from the header, Design note, 2026-08-26:
// […]). Same state, same wire fact as
// the header toggle it replaces — with voice off the portal skips synthesis
// at the source (voice:pref).

import { memo } from 'react';
import { useConsciousnessPick } from './consciousness-context.js';
import { uiSound } from '../../services/ui-sound.js';
import { VoiceForgeInvite } from './voice-forge/VoiceForgeInvite.jsx';
import { isComingLater } from '../coming-later.js';

const VoxChipView = ({ disabled }) => {
  const { voiceEnabled, toggleVoice, activeCompanion } = useConsciousnessPick('voiceEnabled', 'toggleVoice', 'activeCompanion');
  return (
    <>
      {/* A silent being with VOX on: the one click to its forge (Founder's call E,
          docs/work/one-voice.md). Floats above the composer; never moves it. */}
      <VoiceForgeInvite voiceEnabled={voiceEnabled} companion={activeCompanion} />
      <button
        type="button"
        className={`relink-vox-chip${voiceEnabled ? ' is-on' : ''}`}
        disabled={disabled}
        aria-pressed={voiceEnabled}
        title="The being's spoken voice"
        onClick={() => { uiSound('toggle'); toggleVoice(); }}
      >
        VOX {voiceEnabled ? 'ON' : 'OFF'}
      </button>
    </>
  );
};

// Memoized: the composer re-renders on every keystroke; this does not need to
// (2026-09-28 smoothness pass).
// Held back from the early release (coming-later.js): no chip, no forge invite.
export const VoxChip = isComingLater('voice') ? () => null : memo(VoxChipView);
