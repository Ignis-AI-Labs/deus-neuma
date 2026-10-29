// ServingFitCard — how much of the GPU the mind may fill, and what the serving
// holds right now (Design note, 2026-10-20: […]).
//
// The share is the operator's saved choice; the context pool is fitted to it
// at every ignition (backend/services/serving-fit.js). Every number shown is
// read live from the card and the server, or from the saved last fit.

import { useCallback, useEffect, useState } from 'react';
import { loadServingFit, saveServingShare } from './serving-fit-client.js';
import { useVisibleInterval } from './use-visible-interval.js';
import { formatRelativeTime } from '../../utils/format.js';
import { Chip, StackBar } from './hud-instruments.jsx';

const gb = (mib) => (Number.isFinite(mib) ? (mib / 1024).toFixed(1) : '—');
const tokens = (n) => (Number.isFinite(n) ? `${Math.round(n / 1024)}K` : '—');

/**
 * pure — the card's memory as its parts (the model server, everything else,
 * free) and the share as a mark on the same whole: where the mind may reach.
 */
export const cardParts = (status, share) => {
  const total = status?.gpu?.totalMiB;
  const used = status?.gpu?.usedMiB;
  if (!Number.isFinite(total) || !Number.isFinite(used)) return null;
  const server = Number.isFinite(status.serverMiB) ? Math.min(status.serverMiB, used) : 0;
  const part = (key, label, value, tone) => ({ key, label, value, tone, text: `${gb(value)}G` });
  return {
    total,
    parts: [part('server', 'MODEL SERVER', server, 'live'), part('other', 'OTHER', used - server, 'dim'), part('free', 'FREE', total - used, 'empty')],
    marks: [{ key: 'share', kind: 'share', at: (total * share) / 100, label: `share ${share}% = ${gb((total * share) / 100)} GB` }],
  };
};

/** pure — the last fit as one honest line. */
export const lastFitLine = (fit) => {
  if (!fit) return 'not fitted yet: the share applies at the next ignition';
  if (fit.fitted === false) return `not fitted: ${fit.reason} — the configured ${tokens(fit.pool)} pool stands`;
  const measured = Number.isFinite(fit.actualMiB) ? ` · measured ${gb(fit.actualMiB)} GB` : ' · measuring after boot';
  return `${tokens(fit.pool)} pool at ${fit.sharePct}% · planned ${gb(fit.plannedMiB)} GB${measured}`;
};

export const ServingFitCard = () => {
  const [status, setStatus] = useState(undefined);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => setStatus(await loadServingFit()), []);
  useEffect(() => { refresh(); }, [refresh]);
  const watch = useVisibleInterval(refresh, 10_000);

  if (status === undefined) return <p className="rec-line label-data">GPU SHARE · LOADING…</p>;
  if (status === null) return <p className="rec-line label-data">GPU SHARE · UNREADABLE — the platform did not answer</p>;

  const share = draft ?? status.sharePct;
  const dirty = draft !== null && draft !== status.sharePct;
  const card = cardParts(status, share);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveServingShare(share);
      setDraft(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rec-cap" ref={watch}>
      <p className="rec-line label-data">
        GPU SHARE FOR THE MIND · <span className="rec-sig">{share}%</span>{status.shareSaved || dirty ? '' : ' (default)'}
      </p>
      <div className="settings-row">
        <input
          type="range"
          className="settings-vol-dial"
          min="50"
          max="95"
          step="5"
          value={share}
          aria-label="GPU share the mind may fill"
          onChange={(e) => setDraft(Number(e.target.value))}
        />
        <button type="button" className="rec-btn rec-btn-go" disabled={!dirty || saving} onClick={save}>
          {saving ? 'SAVING…' : 'SAVE'}
        </button>
      </div>
      <p className="rec-note">
        The model server&apos;s context pool is sized to this share at every ignition. A new share applies at the next ignition.
      </p>
      {error ? <p className="rec-warn">{error}</p> : null}
      {!status.measurable ? (
        <p className="rec-warn">This machine cannot be measured (no NVIDIA card, or llama-fit-params missing beside llama-server): the configured pool stands.</p>
      ) : null}
      {card ? <StackBar parts={card.parts} total={card.total} marks={card.marks} /> : null}
      {status.serving ? (
        <div className="hud-chips">
          <Chip k="POOL" v={`${tokens(status.pool)} TOKENS`} tone="live" />
          <Chip k="SLOTS" v={status.slots ?? '—'} />
          <Chip k="ONE BEING" v={`≤ ${tokens(status.beingWindow)}${status.trainCtx ? ' (TRAINED WINDOW)' : ''}`} />
        </div>
      ) : <p className="rec-line label-data">MODEL SERVER DOWN — the pool is fitted when it is lit</p>}
      <p className="rec-line label-data">
        LAST FIT · {lastFitLine(status.lastFit)}{status.lastFit?.at ? ` · ${formatRelativeTime(status.lastFit.at)}` : ''}
      </p>
    </div>
  );
};
