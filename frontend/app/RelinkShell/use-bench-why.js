// use-bench-why.js — THE WHY's IO: a matched set's diagnosis (why items
// were missed, #557) and a run's evidence (what happened inside it — stages,
// exit codes, log tails), fetched on demand and kept per id. Design note, 2026-09-26:
// […]
//
// The panels (BenchWhy.jsx) stay pure: they receive an entry
// ({state: 'loading'|'ready'|'error', data, error}) and ask for it with
// request*. The cache clears whenever a matched set settles — a set's
// diagnosis changes as its arms land.
//
// impure — network reads.

import { useCallback, useRef, useState } from 'react';
import { getBenchDiagnosis, getBenchRunEvidence } from '../../services/bench-client.js';

const FETCHERS = Object.freeze({ diagnosis: getBenchDiagnosis, evidence: getBenchRunEvidence });

export const useBenchWhy = () => {
  const [entries, setEntries] = useState({});
  const asked = useRef(new Set()); // keys in flight or settled — each is fetched once

  const request = useCallback((kind, id) => {
    if (!id || !FETCHERS[kind]) return;
    const key = `${kind}:${id}`;
    if (asked.current.has(key)) return;
    asked.current.add(key);
    setEntries((e) => ({ ...e, [key]: { state: 'loading', data: null, error: null } }));
    FETCHERS[kind](id)
      .then((data) => setEntries((e) => ({ ...e, [key]: { state: 'ready', data, error: null } })))
      .catch((error) => {
        asked.current.delete(key); // a failed read may be asked again
        setEntries((e) => ({ ...e, [key]: { state: 'error', data: null, error: error?.message ?? String(error) } }));
      });
  }, []);

  const reset = useCallback(() => {
    asked.current.clear();
    setEntries({});
  }, []);

  // Stable askers — the panels' effects depend on them.
  const requestDiagnosis = useCallback((comparisonId) => request('diagnosis', comparisonId), [request]);
  const requestEvidence = useCallback((runId) => request('evidence', runId), [request]);

  return {
    diagnosis: (comparisonId) => entries[`diagnosis:${comparisonId}`] ?? null,
    evidence: (runId) => entries[`evidence:${runId}`] ?? null,
    requestDiagnosis,
    requestEvidence,
    reset,
  };
};
