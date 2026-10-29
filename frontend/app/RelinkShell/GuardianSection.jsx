// GuardianSection — the CSO office panel, inside Settings > Security.
//
// The house's standing security watch made visible: the posture strip (last
// scan, host, ledger counts), the single CSO seat and who holds it, the threat
// ledger the watch sweeps findings into, and the watch list itself (repos +
// expected host ports). Every read is server truth; every write is the
// operator's own call; every refusal is shown, never swallowed. All IO lives
// in services/cso-client.js — this file is display and intent only.

import { useEffect, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { formatDateTime } from '../../utils/format.js';
import { EmptyState } from './empty-state.jsx';
import { Select } from './Select.jsx';
import {
  getPosture, getScan, runScan,
  seatCso, clearCso,
  getThreats,
  getWatch, addWatchedRepo, removeWatchedRepo, setExpectedPorts,
} from '../../services/cso-client.js';
import { safeHttpUrl } from './safe-url.js';

const THREAT_STATUSES = Object.freeze(['new', 'not_affected', 'confirmed', 'mitigated', 'needs_operator']);
const THREAT_ROW_CAP = 30;

// A severity reads loud only while it can hurt: critical and high carry the
// alert register, the rest stay in the data register.
const severityTagClass = (severity) =>
  severity === 'critical' || severity === 'high' ? 'settings-tag-warn' : 'settings-tag-dim';

// Ledger statuses that still owe action stand out; resolved ones dim.
const statusTagClass = (status) => {
  if (status === 'mitigated') return 'settings-tag-ok';
  if (status === 'not_affected') return 'settings-tag-dim';
  return 'settings-tag-warn';
};

const statusLabel = (status) => (status || '').replace(/_/g, ' ').toUpperCase();

// A comma-separated ports draft becomes the clean number list the watch keeps;
// anything that is not a valid port is dropped rather than silently mangled.
const parsePorts = (draft) =>
  draft.split(',')
    .map((p) => Number(p.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p <= 65535);

// `harness`: a harness desk keeps the machine's watch + ledger; the seat is a being's office
export const GuardianSection = ({ beings = [], harness = false }) => {
  const [posture, setPosture] = useState(null);
  const [scan, setScan] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [runSummary, setRunSummary] = useState(null);

  const [pick, setPick] = useState('');
  const [seatBusy, setSeatBusy] = useState(false);
  const [seatError, setSeatError] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const [statusFilter, setStatusFilter] = useState(''); // '' = ALL
  const [ledger, setLedger] = useState(null);
  const [threatError, setThreatError] = useState(null);

  const [watch, setWatch] = useState(null);
  const [watchError, setWatchError] = useState(null);
  const [newPath, setNewPath] = useState('');
  const [watchBusy, setWatchBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null); // watched repo id awaiting confirm
  const [portsDraft, setPortsDraft] = useState('');
  const [portsBusy, setPortsBusy] = useState(false);
  const [portsError, setPortsError] = useState(null);

  // The strip reads posture + scan together — one failure blanks neither.
  const loadStrip = () =>
    Promise.all([getPosture(), getScan()])
      .then(([p, s]) => { setPosture(p); setScan(s.scan); setLoadError(null); })
      .catch((e) => setLoadError(e.message)); // surfaced, not swallowed

  const refreshPosture = () =>
    getPosture()
      .then((p) => { setPosture(p); setLoadError(null); })
      .catch((e) => setLoadError(e.message));

  const loadThreats = (status = statusFilter) =>
    getThreats(status ? { status } : {})
      .then((r) => { setLedger(r); setThreatError(null); })
      .catch((e) => setThreatError(e.message)); // surfaced, not swallowed

  const loadWatch = () =>
    getWatch()
      .then((r) => {
        setWatch(r.watch);
        setPortsDraft((r.watch?.host?.expectedPorts || []).join(', '));
        setWatchError(null);
      })
      .catch((e) => setWatchError(e.message)); // surfaced, not swallowed

  useEffect(() => { loadStrip(); loadThreats(''); loadWatch(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // RUN SCAN NOW — out of cycle. The returned summary is shown as it came
  // back, then the strip and ledger reload so the panel speaks fresh truth.
  const runNow = async () => {
    uiSound('activate');
    setScanBusy(true); setScanError(null); setRunSummary(null);
    try {
      const { summary } = await runScan();
      setRunSummary(summary);
      await Promise.all([loadStrip(), loadThreats()]);
    } catch (e) {
      setScanError(e.message);
    }
    setScanBusy(false);
  };

  const designate = async () => {
    uiSound('activate');
    setSeatBusy(true); setSeatError(null);
    try {
      await seatCso(pick);
      setPick('');
      await refreshPosture();
    } catch (e) {
      setSeatError(e.message);
    }
    setSeatBusy(false);
  };

  const clearSeat = async () => {
    uiSound('activate');
    setConfirmClear(false);
    setSeatBusy(true); setSeatError(null);
    try {
      await clearCso();
      await refreshPosture();
    } catch (e) {
      setSeatError(e.message);
    }
    setSeatBusy(false);
  };

  const pickFilter = (status) => {
    uiSound('toggle');
    setStatusFilter(status);
    loadThreats(status);
  };

  const addRepo = async () => {
    uiSound('activate');
    setWatchBusy(true); setWatchError(null);
    try {
      const r = await addWatchedRepo(newPath.trim());
      setWatch(r.watch);
      setNewPath('');
      await refreshPosture();
    } catch (e) {
      setWatchError(e.message);
    }
    setWatchBusy(false);
  };

  const removeRepo = async (id) => {
    uiSound('activate');
    setConfirmRemove(null);
    setWatchBusy(true); setWatchError(null);
    try {
      const r = await removeWatchedRepo(id);
      setWatch(r.watch);
      await refreshPosture();
    } catch (e) {
      setWatchError(e.message);
    }
    setWatchBusy(false);
  };

  const savePorts = async () => {
    uiSound('activate');
    setPortsBusy(true); setPortsError(null);
    try {
      const r = await setExpectedPorts(parsePorts(portsDraft));
      setWatch((w) => (w ? { ...w, host: r.host } : w));
      setPortsDraft((r.host?.expectedPorts || []).join(', '));
    } catch (e) {
      setPortsError(e.message);
    }
    setPortsBusy(false);
  };

  const cso = posture?.cso || null;
  const holderName = cso ? (beings.find((b) => b.neumaId === cso.laneId)?.name || cso.laneId) : null;
  const counts = posture?.counts;
  const host = scan?.host;
  const threatRows = ledger?.threats || [];
  const repoRows = watch?.repos || [];

  return (
    <>
      {/* ── THE WATCH ──────────────────────────────────────────────── */}
      <section className="settings-sec">
        <div className="label-data settings-h">THE WATCH</div>
        <p className="settings-note">
          {harness ? 'The platform\'s standing security watch — it sweeps' : 'The house\'s standing security watch — the CSO office sweeps'} the
          watched repos and this host on a 24-hour cycle and files what it finds in the threat ledger below.
        </p>

        {loadError ? <p className="settings-err">{loadError}</p> : null}

        {posture && scan ? (
          <div className="settings-realm">
            <div className="settings-row">
              <span className="settings-k">Last scan</span>
              <span className="settings-v">
                {scan.lastRunAt ? formatDateTime(scan.lastRunAt) : 'never run'}
              </span>
            </div>
            {host?.kernel || host?.nvidiaDriver ? (
              <div className="settings-row">
                <span className="settings-k">Host</span>
                <span className="settings-v">
                  {[host?.kernel, host?.nvidiaDriver ? `NVIDIA ${host.nvidiaDriver}` : null]
                    .filter(Boolean).join(' · ')}
                </span>
              </div>
            ) : null}
            <div className="settings-row">
              <span className="settings-k">Watching</span>
              <span className="settings-v">
                {posture.watch?.repos?.length ?? 0} repo{(posture.watch?.repos?.length ?? 0) === 1 ? '' : 's'}
              </span>
            </div>
            {counts ? (
              <div className="settings-row">
                <span className="settings-k">Ledger</span>
                <span className="settings-v">
                  <span className="settings-sec-tags">
                    <span className="settings-tag-dim">{counts.total ?? 0} TOTAL</span>
                    {THREAT_STATUSES.map((s) => {
                      const n = counts.byStatus?.[s] || 0;
                      const hot = n > 0 && (s === 'new' || s === 'confirmed' || s === 'needs_operator');
                      return (
                        <span key={s} className={hot ? 'settings-tag-warn' : 'settings-tag-dim'}>
                          {statusLabel(s)} {n}
                        </span>
                      );
                    })}
                  </span>
                </span>
              </div>
            ) : null}
          </div>
        ) : (
          !loadError && <EmptyState title="READING THE WATCH…" />
        )}

        <div className="settings-control">
          <button type="button" className="settings-set" onClick={runNow} disabled={scanBusy}>
            {scanBusy ? 'SCANNING…' : 'RUN SCAN NOW'}
          </button>
        </div>
        {scanError ? <p className="settings-err">{scanError}</p> : null}
        {runSummary ? (
          <div className="settings-realm settings-plan">
            <p className="settings-note">
              Scan finished {formatDateTime(runSummary.finishedAt)} — {runSummary.added ?? 0} new,
              {' '}{runSummary.seen ?? 0} already on the ledger.
            </p>
            {(runSummary.repos || []).filter((r) => r.error).map((r) => (
              <p key={r.repo} className="settings-err">{r.repo}: {r.error}</p>
            ))}
          </div>
        ) : null}
      </section>

      {/* ── THE CSO SEAT ── (a being's office: never on a harness desk) */}{harness ? null : (
      <section className="settings-sec">
        <div className="label-data settings-h">THE CSO SEAT</div>
        <p className="settings-note">
          One being holds the Chief Security Officer office — its lane runs the
          watch and owns the ledger. Clearing the seat stops the office, never
          the record.
        </p>

        {posture ? (
          <div className="settings-realm">
            <div className="settings-row">
              <span className="settings-k">CHIEF SECURITY OFFICER</span>
              <span className="settings-v">
                <span className="settings-sec-tags">
                  {cso
                    ? <span className="settings-tag-ok">HELD BY {holderName} — since {formatDateTime(cso.designatedAt)}</span>
                    : <span className="settings-tag-dim">no CSO seated</span>}
                </span>
              </span>
            </div>
            <div className="settings-control">
              <Select
                fill
                ariaLabel="CSO holder"
                value={pick}
                onChange={setPick}
                disabled={seatBusy || beings.length === 0}
                placeholder="— choose the holder —"
                options={beings.map((b) => ({ value: b.neumaId, label: b.name || b.neumaId }))}
              />
              <button type="button" className="settings-set" disabled={seatBusy || !pick} onClick={designate}>
                {seatBusy ? 'SEATING…' : 'DESIGNATE'}
              </button>
              {cso && !confirmClear ? (
                <button
                  type="button"
                  className="settings-set is-danger"
                  disabled={seatBusy}
                  onClick={() => { uiSound('open'); setConfirmClear(true); }}
                >
                  CLEAR SEAT
                </button>
              ) : null}
            </div>
            {cso && confirmClear ? (
              <span className="settings-backup-confirm">
                <span className="settings-backup-notice">
                  «NOTICE» clear the CSO seat? The threat ledger stays; the office stands empty.
                </span>
                <button type="button" className="settings-backup-del is-danger" onClick={clearSeat} disabled={seatBusy}>
                  CLEAR
                </button>
                <button type="button" className="settings-backup-del" onClick={() => { uiSound('close'); setConfirmClear(false); }}>
                  CANCEL
                </button>
              </span>
            ) : null}
            {seatError ? <p className="settings-err">{seatError}</p> : null}
          </div>
        ) : (
          !loadError && <EmptyState title="READING THE SEAT…" />
        )}
      </section>
      )}

      {/* ── THREAT LEDGER ──────────────────────────────────────────── */}
      <section className="settings-sec">
        <div className="label-data settings-h">THREAT LEDGER</div>
        <p className="settings-note">
          Everything the watch has filed — advisories, sweep hits, host and house
          findings — with the CSO&apos;s assessment on each.
        </p>

        <div className="settings-control">
          {['', ...THREAT_STATUSES].map((s) => (
            <button
              key={s || 'all'}
              type="button"
              className={`settings-desk-toggle${statusFilter === s ? ' on' : ''}`}
              aria-pressed={statusFilter === s}
              onClick={() => pickFilter(s)}
            >
              {s ? statusLabel(s) : 'ALL'}
            </button>
          ))}
        </div>

        {threatError ? <p className="settings-err">{threatError}</p> : null}

        {ledger ? (
          threatRows.length ? (
            <>
              <ul className="settings-files">
                {threatRows.slice(0, THREAT_ROW_CAP).map((t) => (
                  <li key={t.id}>
                    <code>{t.title}</code>
                    <span className="settings-sec-tags">
                      <span className={severityTagClass(t.severity)}>
                        {(t.severity || 'unknown').toUpperCase()}
                      </span>
                      <span className={statusTagClass(t.status)}>{statusLabel(t.status)}</span>
                      <span className="settings-tag-dim">
                        {(t.layer || '').toUpperCase()}{t.repo ? ` · ${t.repo}` : ''}
                      </span>
                      {safeHttpUrl(t.githubIssue) ? (
                        <a className="settings-tag-dim" href={safeHttpUrl(t.githubIssue)} target="_blank" rel="noreferrer">
                          ISSUE ↗
                        </a>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {threatRows.length > THREAT_ROW_CAP ? (
                <p className="settings-note">…and {threatRows.length - THREAT_ROW_CAP} more.</p>
              ) : null}
            </>
          ) : (
            <EmptyState title="NOTHING ON THE LEDGER." />
          )
        ) : (
          !threatError && <EmptyState title="READING THE LEDGER…" />
        )}
      </section>

      {/* ── WATCH LIST ─────────────────────────────────────────────── */}
      <section className="settings-sec">
        <div className="label-data settings-h">WATCH LIST</div>
        <p className="settings-note">
          The repos the sweep walks and the ports this host is expected to listen
          on — a listener anywhere else is a finding.
        </p>

        {watchError ? <p className="settings-err">{watchError}</p> : null}

        {watch ? (
          <>
            {repoRows.length ? (
              <ul className="settings-files">
                {repoRows.map((repo) => (
                  <li key={repo.id} className="settings-backup-row">
                    <code>{repo.path}</code>
                    <span className="settings-sec-tags">
                      <span className={repo.hasLockfile ? 'settings-tag-ok' : 'settings-tag-warn'}>
                        {repo.hasLockfile ? 'LOCKFILE' : 'NO LOCKFILE'}
                      </span>
                    </span>
                    {confirmRemove === repo.id ? (
                      <span className="settings-backup-confirm">
                        <span className="settings-backup-notice">
                          «NOTICE» stop watching this repo? Its ledger entries stay.
                        </span>
                        <button type="button" className="settings-backup-del is-danger" onClick={() => removeRepo(repo.id)} disabled={watchBusy}>
                          REMOVE
                        </button>
                        <button type="button" className="settings-backup-del" onClick={() => { uiSound('close'); setConfirmRemove(null); }}>
                          CANCEL
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="settings-backup-del"
                        onClick={() => { uiSound('open'); setConfirmRemove(repo.id); }}
                        aria-label={`Stop watching ${repo.path}`}
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="NO REPOS UNDER THE WATCH YET." />
            )}

            <div className="settings-control">
              <input
                type="text"
                className="settings-input"
                placeholder="/absolute/path/to/repo"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                aria-label="Repo path to watch"
              />
              <button type="button" className="settings-set" onClick={addRepo} disabled={watchBusy || !newPath.trim()}>
                {watchBusy ? 'WORKING…' : 'WATCH PATH'}
              </button>
            </div>

            <div className="settings-row">
              <span className="settings-k">Expected ports</span>
              <span className="settings-v">
                {(watch.host?.expectedPorts || []).length
                  ? watch.host.expectedPorts.join(', ')
                  : 'none declared'}
              </span>
            </div>
            <div className="settings-control">
              <input
                type="text"
                className="settings-input"
                placeholder="3333, 7777"
                value={portsDraft}
                onChange={(e) => setPortsDraft(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                aria-label="Expected host ports"
              />
              <button type="button" className="settings-set" onClick={savePorts} disabled={portsBusy}>
                {portsBusy ? 'SAVING…' : 'SAVE PORTS'}
              </button>
            </div>
            {portsError ? <p className="settings-err">{portsError}</p> : null}
          </>
        ) : (
          !watchError && <EmptyState title="READING THE WATCH LIST…" />
        )}
      </section>
    </>
  );
};
