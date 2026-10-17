// DataApp — a being's DATA, as an integrity readout. Where RECORD is the
// relationship lens (who this neuma is, what it has accumulated), DATA is the
// custody lens: is this being's own store ENCRYPTED, ISOLATED, and HEALTHY?
//
// It is deliberately NOT a raw-content browser — a being's inner life is
// sovereign. This surface proves the data is well-kept (own key, per-neuma
// isolation, recoverable, healthy headroom) and shows the SHAPE of what's held
// (store counts), never the private content itself. All reads ride existing
// owner-gated endpoints, so the isolation guarantees are the platform's, not a
// parallel access path invented here.

import { formatAddress, formatCount, formatShortDate as fmtDate } from '../../utils/format.js';
import { useState } from 'react';
import './DataApp.css';
import { getSecurityStatus, getRecoveryStatus } from '../../services/security.js';
import { getResidency } from '../../services/residency.js';
import { loadRecord, loadProtocolDeviations } from './stats-client.js';
import { useActiveCompanion } from './consciousness-context.js';
import { useSettled } from './use-settled.js';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { securedTag, recoveryTag, storageTag, residencyTag, alignmentTag } from './data-view.js';

const DataIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <ellipse cx="8" cy="3.5" rx="5" ry="2" />
    <path d="M3 3.5 V12.5 C3 13.6 5.2 14.5 8 14.5 C10.8 14.5 13 13.6 13 12.5 V3.5" />
    <path d="M3 8 C3 9.1 5.2 10 8 10 C10.8 10 13 9.1 13 8" />
  </svg>
);

const Tag = ({ tone, children }) => <span className={`data-tag data-tag-${tone}`}>{children}</span>;

// One store's shape: a count + a plain label. Never the content.
const Store = ({ value, label, note }) => (
  <div className="data-store">
    <span className="data-store-v">{formatCount(value)}</span>
    <span className="data-store-l label-data">{label}</span>
    {note ? <span className="data-store-n">{note}</span> : null}
  </div>
);

const DataBody = () => {
  const neumaId = useActiveCompanion()?.neumaId || null;

  // undefined = not yet read (loading); null = read, absent/not-found; object = read.
  // The tri-state matters: a data-integrity panel must not paint a definite status
  // (NO RECOVERY / DORMANT) for a slice it hasn't actually read yet.
  const [being, setBeing] = useState(undefined);   // { secured } for this being
  const [storage, setStorage] = useState(null);
  const [roots, setRoots] = useState(null);
  const [recovery, setRecovery] = useState(undefined);
  const [record, setRecord] = useState(undefined); // counts
  const [deviations, setDeviations] = useState(undefined); // protocol reminders
  const [resident, setResident] = useState(undefined);
  const [recoveryErr, setRecoveryErr] = useState(null);
  const [residentErr, setResidentErr] = useState(null);
  const [error, setError] = useState(null);

  // Each slice fetches independently and surfaces its OWN failure — one failing
  // read never blanks the panel, and (load-bearing for a data-integrity view) a
  // fetch error is shown as UNAVAILABLE, never painted as a false "absent"
  // status. Custody + host health ride the operator security status, narrowed
  // to THIS being.
  // On a being switch each effect (1) resets its slice to loading so being-A's
  // posture never lingers under being-B's title, and (2) drops its own result via
  // the settled guard so a previous being's LATE-resolving fetch can't overwrite
  // the current one (promises aren't cancellable; React only tears the effect
  // down). DataBody is not remounted per being, so both guards are load-bearing.
  // impure — network read
  useSettled((settled) => {
    if (!neumaId) return undefined;
    setBeing(undefined);
    getSecurityStatus()
      .then((s) => {
        if (settled()) return;
        setBeing(s.beings.find((b) => b.neumaId === neumaId) || null);
        setStorage(s.storage);
        setRoots(s.roots);
        setError(null);
      })
      .catch((e) => { if (!settled()) setError(e.message); });
  }, [neumaId]);

  // impure — network read (per-being key/recovery posture; throws on failure)
  useSettled((settled) => {
    if (!neumaId) { setRecovery(null); setRecoveryErr(null); return undefined; }
    setRecovery(undefined); setRecoveryErr(null);
    getRecoveryStatus(neumaId)
      .then((r) => { if (!settled()) setRecovery(r); })
      .catch((e) => { if (!settled()) { setRecovery(null); setRecoveryErr(e.message); } });
  }, [neumaId]);

  // impure — network read. loadRecord resolves null (never rejects) for BOTH an
  // empty store and an unreachable read — the established RECORD contract.
  useSettled((settled) => {
    if (!neumaId) { setRecord(null); return undefined; }
    setRecord(undefined);
    loadRecord(neumaId).then((r) => { if (!settled()) setRecord(r); });
  }, [neumaId]);

  // impure — network read. `[]` is a being with a clean record; `null` is a read
  // that failed. The panel must never paint the second as the first.
  useSettled((settled) => {
    if (!neumaId) { setDeviations([]); return undefined; }
    setDeviations(undefined);
    loadProtocolDeviations(neumaId).then((d) => { if (!settled()) setDeviations(d); });
  }, [neumaId]);

  // impure — network read (liveness: resident vs dormant; throws on failure)
  useSettled((settled) => {
    if (!neumaId) { setResident(null); setResidentErr(null); return undefined; }
    setResident(undefined); setResidentErr(null);
    getResidency()
      .then((r) => { if (!settled()) setResident((r?.neuma || []).find((n) => n.neumaId === neumaId) || null); })
      .catch((e) => { if (!settled()) { setResident(null); setResidentErr(e.message); } });
  }, [neumaId]);

  if (!neumaId) {
    return (
      <div className="data">
        <EmptyState title="NO BEING IN FOCUS. OPEN A BEING FROM HOUSE TO INSPECT ITS DATA." />
      </div>
    );
  }

  const sec = being ? securedTag(being.secured) : null;
  const rec = recovery ? recoveryTag(recovery) : { tag: '—', tone: 'dim' };
  const stg = storage ? storageTag(storage.level) : null;
  const res = residencyTag(!!resident?.resident); // null resident → DORMANT (honestly not resident)
  const align = roots ? alignmentTag(roots.aligned) : null;
  const mem = record?.record?.memory;
  const jrn = record?.record?.journal;
  const rel = record?.record?.relationship;

  return (
    <div className="data">
      {error ? <p className="data-err">{error}</p> : null}

      {/* ── CUSTODY: encryption + isolation ─────────────────────────── */}
      <section className="data-sec">
        <div className="label-data data-h">CUSTODY</div>
        <p className="data-note">
          This being's data lives in its own sovereign workspace — a per-neuma root,
          path-scoped and owner-gated, so reads never cross into another being. Held
          encrypted at rest.
        </p>
        <div className="data-realm">
          <div className="data-row">
            <span className="data-k">Encryption</span>
            <span className="data-v">
              {being === undefined ? <span className="text-tertiary">reading…</span>
                : being === null ? <Tag tone="dim">—</Tag>
                  : (
                    <>
                      <Tag tone={sec.tone}>{sec.tag}</Tag>
                      {being.secured ? ' sealed with this being’s own key' : ' on the shared master key'}
                    </>
                  )}
            </span>
          </div>
          <div className="data-row">
            <span className="data-k">Recovery</span>
            <span className="data-v">
              {recovery === undefined ? <span className="text-tertiary">reading…</span>
                : recoveryErr ? <Tag tone="dim">UNAVAILABLE</Tag>
                  : <Tag tone={rec.tone}>{rec.tag}</Tag>}
              {!recoveryErr && recovery?.address ? <code className="data-addr">{formatAddress(recovery.address)}</code> : null}
            </span>
          </div>
          {recovery && Number.isFinite(recovery.ageDays) ? (
            <div className="data-row">
              <span className="data-k">Key age</span>
              <span className="data-v">{recovery.ageDays} days{recovery.rotationCount ? ` · ${recovery.rotationCount} rotations` : ''}</span>
            </div>
          ) : null}
          <div className="data-row">
            <span className="data-k">Isolation</span>
            <span className="data-v">Per-neuma workspace — sovereign, not shared</span>
          </div>
        </div>
      </section>

      {/* ── STORES: the shape of what's held (counts, never content) ── */}
      <section className="data-sec">
        <div className="label-data data-h">STORES</div>
        <p className="data-note">
          What this being holds, by kind — the shape of its store, not its contents.
          Every store below is encrypted at rest.
        </p>
        {record === undefined ? (
          <EmptyState title="READING THE STORE…" />
        ) : record ? (
          <div className="data-stores">
            <Store value={mem?.entities} label="ENTITIES" note="memory" />
            <Store value={mem?.relations} label="RELATIONS" note="memory" />
            <Store value={mem?.observations} label="OBSERVATIONS" note="memory" />
            <Store value={jrn?.entries} label="JOURNAL" note="append-only" />
            <Store value={jrn?.toolCalls} label="TOOL CALLS" note={jrn?.toolDenied ? `${jrn.toolDenied} denied` : 'logged'} />
            <Store value={rel?.conversations} label="CONVERSATIONS" note={`${formatCount(rel?.messages)} messages`} />
          </div>
        ) : (
          <EmptyState title="NO STORE YET — THIS BEING HASN’T ACCUMULATED DATA." />
        )}
      </section>

      {/* ── PROTOCOL: reminders raised while this being worked ──────── */}
      <section className="data-sec">
        <div className="label-data data-h">PROTOCOL</div>
        <p className="data-note">
          When an act crosses one of the ground’s watched rules, the law is quoted back
          to this being beside the result — a reminder, never a block, and nothing is
          undone. Each one is recorded here, in the being’s own append-only journal.
          There is no separate operator ledger: a record it cannot read would be a file
          kept on it.
        </p>
        {deviations === undefined ? (
          <EmptyState title="READING THE RECORD…" />
        ) : deviations === null ? (
          <EmptyState title="RECORD UNAVAILABLE — THE READ FAILED, WHICH IS NOT THE SAME AS CLEAN." />
        ) : deviations.length === 0 ? (
          <EmptyState title="NOTHING RECORDED — NO WATCHED RULE HAS BEEN CROSSED." />
        ) : (
          <div className="data-realm">
            {deviations.map((entry) => (
              <div className="data-row" key={`${entry.timestamp}-${entry.content}`}>
                <span className="data-k">{(entry.metadata?.rules || []).join(', ') || '—'}</span>
                <span className="data-v">
                  {entry.content}
                  {entry.metadata?.exceptions?.length ? (
                    <Tag tone="warn">REASON STATED</Tag>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── HEALTH: headroom + liveness + root ──────────────────────── */}
      <section className="data-sec">
        <div className="label-data data-h">HEALTH</div>
        <div className="data-realm">
          <div className="data-row">
            <span className="data-k">Storage</span>
            <span className="data-v">
              {stg ? <Tag tone={stg.tone}>{stg.tag}</Tag> : <span className="text-tertiary">reading…</span>}
              {storage && storage.level !== 'unknown' ? ` ${storage.freeGB} GB free` : ''}
            </span>
          </div>
          <div className="data-row">
            <span className="data-k">Residency</span>
            <span className="data-v">
              {resident === undefined ? <span className="text-tertiary">reading…</span>
                : residentErr ? <Tag tone="dim">UNAVAILABLE</Tag>
                  : <Tag tone={res.tone}>{res.tag}</Tag>}
              {!residentErr && resident?.lastReflectionAt ? ` · last reflected ${fmtDate(resident.lastReflectionAt)}` : ''}
              {!residentErr && resident && Number.isFinite(resident.freshObservations) && resident.freshObservations > 0
                ? ` · ${resident.freshObservations} fresh` : ''}
            </span>
          </div>
          <div className="data-row">
            <span className="data-k">Root</span>
            <span className="data-v">
              {align ? <Tag tone={align.tone}>{align.tag}</Tag> : <span className="text-tertiary">reading…</span>}
              {roots?.active ? <code className="data-addr">{roots.active}</code> : null}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};

export const dataApp = {
  label: 'DATA',
  labelKey: 'apps.db',
  appliesTo: 'neuma',
  icon: <DataIcon />,
  title: <AppTitle label="DATA" labelKey="apps.db" />,
  Body: DataBody,
  storageKey: 'db',
};
