// Player — the forge's one player, the same everywhere something can be heard
// (Design note, 2026-10-01: […]): ▶ and what it is; once it is the loaded sound, pause, back 5 s,
// a bar to drag and the time against the length, in place.
//
// impure: fetches the audio (via `load`) only when first played, and hands it
// to forge-player.js — one sound at a time across the forge; starting another
// unloads this one. Leaving the forge unloads it (forge-player's closePlayer,
// called by VoiceApp). A sound that will not play says why beside it.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';
import { playUrl, seekPlayer, skipPlayer, togglePlayer, usePlayer } from './forge-player.js';
import { PauseIcon, PlayIcon, RewindIcon } from './forge-icons.jsx';

const REWIND_S = 5;

/** pure — seconds as m:ss. */
export const clockOf = (seconds) => {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * @param {{playKey: string, label: string, load: () => Promise<string>, compact?: boolean}} props
 *   playKey: names the sound in the one player; load: resolves an object URL
 *   (the player owns and frees it); compact: the controls wrap under the label
 */
export const Player = ({ playKey, label, load, compact = false }) => {
  const { t } = useTranslation('voiceForge');
  const now = usePlayer();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const loaded = now.key === playKey;
  const playing = loaded && now.playing;

  const toggle = async () => {
    uiSound('toggle');
    setError(null);
    if (loaded) {
      togglePlayer();
      return;
    }
    setLoading(true);
    try {
      await playUrl(await load(), { key: playKey }).started;
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const playLabel = playing ? t('player.pause') : t('player.play');
  return (
    <div className="vf-player" data-key={playKey} data-loaded={loaded} data-playing={playing} data-compact={compact}>
      <button type="button" className="vf-play" data-playing={playing} data-loading={loading} aria-label={`${playLabel} — ${label}`} title={playLabel} onClick={toggle}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <span className="label-data vf-player-label">{label}</span>
      {loaded ? (
        <span className="vf-player-controls">
          <button type="button" className="vf-player-btn vf-player-back" aria-label={t('player.back', { s: REWIND_S })} title={t('player.back', { s: REWIND_S })} onClick={() => skipPlayer(-REWIND_S)}>
            <RewindIcon />
          </button>
          <input
            className="vf-player-seek"
            type="range"
            min={0}
            max={now.duration || 0}
            step={0.05}
            value={Math.min(now.time, now.duration || 0)}
            disabled={!now.duration}
            aria-label={t('player.seek')}
            onChange={(e) => seekPlayer(Number(e.target.value))}
          />
          <span className="label-data vf-player-clock">{clockOf(now.time)} / {clockOf(now.duration)}</span>
        </span>
      ) : null}
      {error ? <span className="vf-note vf-note-alert">{error}</span> : null}
    </div>
  );
};
