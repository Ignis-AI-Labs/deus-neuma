// BenchApp — THE BENCH WINDOW: the operator's measure of the rig, as a
// first-class desk surface beside the CHIEF OF STAFF and the CSO's SECURITY.
// The harness is sovereign: this window reads its state and launches its
// verbs through the plane's closed catalog — it never writes into it.
//
// Read-mostly by design: OVERVIEW polls /status every 15s while the window
// is seen, never while shaded or hidden (the watch tail rides /status; proof
// progress polls only while a run is live); the only acts are the operator's
// own — CHECK READINESS, RUN, the plan verbs, the plane's STOP, and the
// recovery console.
//
// impure shell only: every render decision lives in BenchBody.jsx +
// BenchReports.jsx + BenchLaunch.jsx + bench-view.js (all pure, all
// node-renderable); the REPORTS state lives in use-bench-reports.js.

import { useEffect, useRef, useState } from 'react';
import './BenchApp.css';
import { AppTitle } from './app-title.jsx';
import { uiSound } from '../../services/ui-sound.js';
import {
  getBenchStatus, getBenchRuns, getBenchCatalog, getBenchModels,
  getBenchPlans, getBenchLanes, postBenchPreflight, postBenchLaunch, postBenchStop,
  postBenchRelight, startBenchProof, getBenchProofRun, getBenchChainReport,
} from '../../services/bench-client.js';
import { isHarnessAbsent, launchResultView } from './bench-view.js';
import { servedModelMatch, fineControlParams } from './bench-launch-view.js';
import { BenchBody, BenchIcon } from './BenchBody.jsx';
import { useBenchReports } from './use-bench-reports.js';
import { useBenchWhy } from './use-bench-why.js';
import { useVisibleInterval } from './use-visible-interval.js';
import { BENCH_WATCH_EVENT } from './bench-run-chip-view.js';

const POLL_MS = 15000;
const PROOF_POLL_MS = 5000;
const RUN_LEDGER_CAP = 500; // the plane's own ceiling (bench-reports.js RUN_CAP)
const EMPTY_FORM = Object.freeze({
  cell: '', arms: ['bare'], model: '', lane: '', workspaceRoot: '',
  limit: '', attempt: '', deadline: '', comparisonId: '', plan: '',
});

const BenchAppBody = () => {
  const [tab, setTab] = useState('overview');
  const [status, setStatus] = useState(null);
  const [absent, setAbsent] = useState(false);
  const [error, setError] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const [runs, setRuns] = useState(null);

  const [cells, setCells] = useState(null);
  const [models, setModels] = useState(null);
  const [lanes, setLanes] = useState(null);
  const [plans, setPlans] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [result, setResult] = useState(null);
  const [confirmNight, setConfirmNight] = useState(false);
  const [reportNote, setReportNote] = useState(null);

  const [relightModel, setRelightModel] = useState('');
  const [relightConfirm, setRelightConfirm] = useState(false);
  const [relightBusy, setRelightBusy] = useState(false);
  const [relightRefusal, setRelightRefusal] = useState(null);
  const [relightOutcome, setRelightOutcome] = useState(null);

  const [proofRun, setProofRun] = useState(null);
  const [proofConfirm, setProofConfirm] = useState(false);
  const [proofBusy, setProofBusy] = useState(false);
  const [proofRefusal, setProofRefusal] = useState(null);
  const [preflightResults, setPreflightResults] = useState(null); // per-arm raw answers — the readiness verdicts read them
  const [runFired, setRunFired] = useState(false);

  const live = useRef(true);
  const modelsRequested = useRef(false);
  const backoffUntil = useRef(0); // a 429 is a transient throttle — quiet, not a banner
  const firstRead = useRef(true); // a window opened on a running benchmark lands on its watch

  // A transient throttle is not an alarm: on 429 the poll backs off to
  // now + retryAfterMs and the banner stays down. Every other error surfaces.
  // impure — reads the thrown error's HTTP metadata (http.js preserves it)
  const surfaceError = (e) => {
    if (e?.http === 429) {
      backoffUntil.current = Date.now() + (Number.isFinite(e.retryAfterMs) ? e.retryAfterMs : POLL_MS);
      return;
    }
    setError(e.message);
  };

  const reports = useBenchReports({ onError: surfaceError, nowMs });
  const why = useBenchWhy(); // WHY IT MISSED + WHAT HAPPENED, fetched on demand

  // THE POLL — /status alone carries the window (the incidents rail's watch
  // tail rides /status now; proof progress polls only while a run is live).
  // One request every 15s while open — the desk's one-wallet cadence met the
  // rate ceiling before this (2026-09-24). An absent harness is a register,
  // not a crash: the «NOTICE» empty state reads there.
  // Gated on sight (use-visible-interval.js): a shaded or hidden BENCH reads
  // nothing, and reads at once when it is opened again.
  const tick = () => {
    if (Date.now() < backoffUntil.current) return; // quiet backoff
    getBenchStatus()
      .then((s) => {
        if (!live.current) return;
        setStatus(s); setAbsent(false); setError(null);
        setNowMs(Date.now());
        // Opened while a benchmark runs (the composer's BENCHMARK chip, a
        // chat's launch): the first read lands on LIVE, where it is watched —
        // once; the operator's own tab choice is never overridden.
        if (firstRead.current) {
          firstRead.current = false;
          if (s?.chain?.state === 'running' || s?.live?.length) onTab('live');
        }
        // The relight panel owes the model catalog only when serving is down —
        // load it once, on the first DOWN reading.
        if (s?.serving?.ok === false && !modelsRequested.current) {
          modelsRequested.current = true;
          getBenchModels()
            .then((m) => { if (live.current) setModels(m.models); })
            .catch(() => { modelsRequested.current = false; }); // next DOWN retries
        }
      })
      .catch((e) => {
        if (!live.current) return;
        if (isHarnessAbsent(e)) setAbsent(true);
        else surfaceError(e);
      });
  };
  useVisibleInterval(tick, POLL_MS);
  useEffect(() => {
    live.current = true;
    // Catch up a run started before this window opened — once, not polled.
    getBenchProofRun()
      .then((p) => { if (live.current) setProofRun(p.run); })
      .catch(() => {});
    return () => { live.current = false; };
  }, []);

  // THE PROOF POLL — while a run is in flight the desk reads its progress
  // every 5s (the 15s tick alone would make a live run look frozen). It backs
  // off quietly on 429 like the status poll. When the run settles, refresh
  // the certificates list if REPORTS has loaded it.
  useVisibleInterval(() => {
    if (Date.now() < backoffUntil.current) return; // quiet backoff
    getBenchProofRun()
      .then((p) => {
        if (!live.current) return;
        setProofRun(p.run);
        if (p.run?.state === 'done' && reports.proofsLoaded) reports.refreshProofs();
      })
      .catch((e) => { if (e?.http === 429) { backoffUntil.current = Date.now() + (e.retryAfterMs ?? PROOF_POLL_MS); } });
  }, PROOF_POLL_MS, { enabled: proofRun?.state === 'running' });

  // THE CHAIN POLL — while a matched set runs, the clock owes the operator a
  // 5s lens (the 15s tick alone would make a live arm look frozen). Same
  // quiet 429 backoff as the other polls; the status read carries the chain.
  useVisibleInterval(() => {
    if (Date.now() < backoffUntil.current) return; // quiet backoff
    getBenchStatus()
      .then((s) => { if (live.current) { setStatus(s); setNowMs(Date.now()); } })
      .catch((e) => { if (e?.http === 429) { backoffUntil.current = Date.now() + (e.retryAfterMs ?? 5000); } });
  }, 5000, { enabled: status?.chain?.state === 'running' || Boolean(status?.live?.length) });

  // THE ATLAS reads on mount (OVERVIEW is the first tab) and again whenever a
  // matched set settles — the receipts it just sealed belong on the chart.
  useEffect(() => {
    if (status?.chain?.state === 'running') return;
    reports.refreshSummary();
    if (runs !== null) refreshRuns();
    why.reset(); // a settled set's diagnosis has changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.chain?.state]);

  // THE LEDGER — the whole record (the plane caps it at RUN_LEDGER_CAP), read
  // on every RUNS open and whenever a matched set settles, never once-and-stale.
  const refreshRuns = () => getBenchRuns(RUN_LEDGER_CAP)
    .then((r) => { if (live.current) setRuns(r.runs); })
    .catch(surfaceError);

  const refreshStatus = () => getBenchStatus()
    .then((s) => { if (live.current) { setStatus(s); setNowMs(Date.now()); } })
    .catch(() => {}); // the poll carries the next truth; an act's own error rides its refusal

  const onTab = (t) => {
    uiSound('open');
    setTab(t);
    if (t === 'runs') refreshRuns(); // every open — a run sealed since belongs on the ledger
    if (t === 'reports') reports.open();
    if (t === 'overview') reports.refreshSummary();
    if ((t === 'launch' || t === 'live') && cells === null) {
      Promise.all([getBenchCatalog(), getBenchModels(), getBenchPlans(), getBenchLanes()])
        .then(([c, m, p, l]) => { setCells(c.cells); setModels(m.models); setPlans(p.plans); setLanes(l.lanes); })
        .catch(surfaceError);
    }
  };

  // THE CHIP'S CALL — the composer's BENCHMARK chip raises this window and asks
  // for LIVE (BenchRunChip.jsx); a window already open turns to it too.
  const onTabRef = useRef(onTab);
  onTabRef.current = onTab;
  useEffect(() => {
    const watch = () => onTabRef.current('live');
    window.addEventListener(BENCH_WATCH_EVENT, watch);
    return () => window.removeEventListener(BENCH_WATCH_EVENT, watch);
  }, []);

  // ── The operator's acts. Every refusal renders the server's own text. ──────

  const onForm = (patch) => setForm((f) => ({ ...f, ...patch }));

  // The subject is the model LOADED NOW, shown not chosen (2026-09-25): the
  // run measures what the registry match names, or the run does not stand.
  const effectiveModel = () => {
    const match = servedModelMatch(status?.serving, models);
    return match.state === 'matched' ? match.model.key : '';
  };

  // FINE CONTROL's law: an empty field is not sent (fineControlParams strips).
  // The desk's run path is ALWAYS the matched set (run-benchmark) — one arm
  // is a matched set of one; attempt is law-pinned to 1 there, so it never
  // rides the desk's params.
  const setParams = () => {
    const fine = fineControlParams({ ...form, attempt: '' });
    return {
      cell: form.cell,
      arms: form.arms,
      model: effectiveModel(),
      ...fine,
    };
  };

  const act = async (title, call) => {
    uiSound('activate');
    setBusy(true);
    setRefusal(null);
    setResult(null);
    setPreflightResults(null);
    setRunFired(false);
    try {
      const answer = await call();
      setResult(launchResultView(title, answer));
      refreshStatus();
      return answer;
    } catch (e) {
      setRefusal(e.message); // the server's own refusal, verbatim
      return null;
    } finally {
      setBusy(false);
    }
  };

  // CHECK READINESS judges EVERY selected arm — one preflight per arm,
  // sequential, each verdict named by its arm (a set is only ready when all
  // of it is).
  const onPreflight = async () => {
    uiSound('activate');
    setBusy(true);
    setRefusal(null);
    setResult(null);
    setRunFired(false);
    try {
      const verdicts = [];
      for (const arm of form.arms) {
        // eslint-disable-next-line no-await-in-loop — sequential and short: the verdicts land in arm order
        const answer = await postBenchPreflight({ cell: form.cell, arm, model: effectiveModel(), ...fineControlParams({ lane: form.lane, workspaceRoot: form.workspaceRoot }) });
        verdicts.push({ arm, result: answer });
      }
      setPreflightResults(verdicts);
    } catch (e) {
      setPreflightResults(null);
      setRefusal(e.message); // the server's own refusal, verbatim
    } finally {
      setBusy(false);
    }
  };
  const onRun = async () => {
    setReportNote(null);
    const answer = await act(`RUN THE MATCHED SET — ${form.cell || '?'} (${form.arms.length})`, () => postBenchLaunch('run-benchmark', setParams()));
    if (answer) { setRunFired(true); onTab('live'); refreshStatus(); } // fired — watched in LIVE
  };
  const onPlanVerb = (verb) => {
    setConfirmNight(false);
    act(`${verb.replace(/-/g, ' ').toUpperCase()} — ${form.plan}`, () => postBenchLaunch(verb, { plan: form.plan }));
  };
  const onReadVerb = (verb) =>
    act(verb.toUpperCase(), () => postBenchLaunch(verb));
  const onStop = async () => {
    uiSound('activate');
    setBusy(true);
    setRefusal(null);
    setResult(null);
    try {
      const answer = await postBenchStop();
      setResult({
        title: 'THE PLANE STOPPED ITS OWN',
        argvLine: 'SIGTERM — the long children this plane launched',
        lines: [`STOPPED PID${answer.stopped.length === 1 ? '' : 'S'} ${answer.stopped.join(', ')}`],
        stdout: '',
      });
      refreshStatus();
    } catch (e) {
      setRefusal(e.message);
    } finally {
      setBusy(false);
    }
  };

  // THE FAILURE REPORT — the server assembles it (chain facts + each failed
  // arm's log tail); this copies it whole so it pastes into a repair thread.
  const onCopyReport = async () => {
    uiSound('activate');
    try {
      const report = await getBenchChainReport();
      await navigator.clipboard.writeText(report.text);
      setReportNote({ ok: true, line: 'REPORT COPIED — PASTE IT WHERE THE REPAIR HAPPENS' });
    } catch (e) {
      uiSound('deny');
      setReportNote({ ok: false, line: `COULD NOT COPY THE REPORT — ${e.message}` });
    }
  };

  // THE RECOVERY CONSOLE — stand the daemons back up with the chosen model.
  // The server's refusal (healthy endpoint, daemon already standing, unknown
  // model) renders verbatim beside the panel.
  const onRelight = async () => {
    uiSound('activate');
    setRelightConfirm(false);
    setRelightBusy(true);
    setRelightRefusal(null);
    setRelightOutcome(null);
    try {
      const answer = await postBenchRelight(relightModel);
      setRelightOutcome(answer);
      refreshStatus();
    } catch (e) {
      setRelightRefusal(e.message); // the server's own refusal, verbatim
    } finally {
      setRelightBusy(false);
    }
  };

  // THE PROOF SUITE — score the loaded model, seal the certificate. The run
  // rides in the background; the fast poll above carries its progress.
  const onRunProof = async () => {
    uiSound('activate');
    setProofConfirm(false);
    setProofBusy(true);
    setProofRefusal(null);
    try {
      const answer = await startBenchProof();
      setProofRun(answer.run);
    } catch (e) {
      setProofRefusal(e.message); // BENCH_NOT_SERVING / BENCH_PROOF_RUNNING, verbatim
    } finally {
      setProofBusy(false);
    }
  };

  return (
    <BenchBody
      tab={tab}
      onTab={onTab}
      absent={absent}
      error={error}
      status={status}
      incidents={{ serving: status?.incidents ?? [], watch: status?.watch ?? [] }}
      nowMs={nowMs}
      runs={runs}
      reports={reports.props}
      why={why}
      atlas={reports.atlas}
      onOpenSuite={(id) => { reports.openSuite(id); onTab('reports'); }}
      live={{
        cells,
        runRows: runs ?? [],
        busy,
        onStop,
        onCopyReport,
        reportNote,
        onLaunch: () => onTab('launch'),
      }}
      launch={{
        onWatch: () => onTab('live'),
        cells,
        models,
        lanes,
        plans,
        form,
        onForm,
        busy,
        refusal,
        result,
        preflightResults,
        runFired,
        chain: status?.chain ?? null,
        runRows: runs ?? [],
        onPreflight,
        onRun,
        onPlanVerb,
        onReadVerb,
        confirmNight,
        onAskNight: () => { uiSound('open'); setConfirmNight(true); },
        onCancelNight: () => { uiSound('close'); setConfirmNight(false); },
        owned: status?.owned ?? [],
        onStop,
        onCopyReport,
        reportNote,
        nowMs,
      }}
      relight={{
        models,
        model: relightModel,
        onModel: (v) => { uiSound('tick'); setRelightModel(v); },
        busy: relightBusy,
        refusal: relightRefusal,
        outcome: relightOutcome,
        confirm: relightConfirm,
        onAsk: () => { uiSound('open'); setRelightConfirm(true); },
        onCancel: () => { uiSound('close'); setRelightConfirm(false); },
        onRelight,
      }}
      proof={{
        run: proofRun,
        confirm: proofConfirm,
        busy: proofBusy,
        refusal: proofRefusal,
        onAsk: () => { uiSound('open'); setProofConfirm(true); },
        onCancel: () => { uiSound('close'); setProofConfirm(false); },
        onRun: onRunProof,
        nowMs,
      }}
    />
  );
};

export const benchApp = {
  label: 'BENCH',
  labelKey: 'apps.bench',
  icon: <BenchIcon />,
  title: <AppTitle label="BENCH" labelKey="apps.bench" />,
  Body: BenchAppBody,
  storageKey: 'bench',
};
