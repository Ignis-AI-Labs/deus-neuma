// use-bench-reports.js — the REPORTS tab's state and IO, lifted out of
// BenchApp.jsx (the 500-line law): SUMMARY's receipts, LIBRARY's list and
// the item being read, SHARE's card. Every render decision lives in the pure
// BenchReports family + bench-summary-view.js.
//
// impure — network reads, object URLs, the clipboard, downloads.

import { useEffect, useRef, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import {
  getBenchBundles, getBenchBundle, getBenchBundleArtifact, getBenchProofs, getBenchProof,
  fetchBenchProofPdf, getBenchSummary, getBenchShare, fetchBenchSharePng,
} from '../../services/bench-client.js';
import { libraryItems, stepLibrary, defaultShareSource, parseShareValue } from './bench-summary-view.js';

const NOTICE_MS = 3000;
// impure — hands bytes to the browser as a download (the DocPressSection idiom)
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

/**
 * @param {{onError: (e: Error) => void, nowMs: number}} deps onError = the
 *   window's surfaceError (429 backs off quietly, everything else banners)
 */
export const useBenchReports = ({ onError, nowMs }) => {
  const [sub, setSub] = useState('explorer');
  const [summary, setSummary] = useState(null);
  const [selectedSuite, setSelectedSuite] = useState(null);
  const [selectedSet, setSelectedSet] = useState({}); // suiteId → series id

  const [bundles, setBundles] = useState(null);
  const [proofsList, setProofsList] = useState(null);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null); // {kind, id}
  const [artifact, setArtifact] = useState('report');
  const [artifactText, setArtifactText] = useState(null);
  const [bundleReport, setBundleReport] = useState(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [proofDetail, setProofDetail] = useState(null); // {receipt, certificate}
  const [proofExportBusy, setProofExportBusy] = useState(false);

  const [shareSource, setShareSource] = useState(null); // {kind, id}
  const [shareSize, setShareSize] = useState('16x9');
  const [shareCard, setShareCard] = useState(null); // {url, blob, markdown, filename}
  const [shareBusy, setShareBusy] = useState(false);
  const [shareNotice, setShareNotice] = useState(null);
  const [shareRefusal, setShareRefusal] = useState(null);
  const cards = useRef(new Map()); // "kind|id|size" → card: a size flip back is instant

  // Revoke every card URL when the window closes.
  useEffect(() => () => { for (const c of cards.current.values()) URL.revokeObjectURL(c.url); }, []);

  // Draw the chosen card whenever SHARE shows a new (source, size).
  useEffect(() => {
    if (sub !== 'share' || !shareSource) return undefined;
    const key = `${shareSource.kind}|${shareSource.id}|${shareSize}`;
    const cached = cards.current.get(key);
    if (cached) { setShareCard(cached); setShareRefusal(null); return undefined; }
    let live = true;
    setShareBusy(true);
    setShareRefusal(null);
    const source = { ...shareSource, size: shareSize };
    Promise.all([getBenchShare(source), fetchBenchSharePng(source)])
      .then(([meta, blob]) => {
        const card = { url: URL.createObjectURL(blob), blob, markdown: meta.markdown, filename: meta.filename };
        cards.current.set(key, card);
        if (live) setShareCard(card);
      })
      .catch((e) => { if (live) setShareRefusal(e.message); })
      .finally(() => { if (live) setShareBusy(false); });
    return () => { live = false; };
  }, [sub, shareSource, shareSize]);

  const notice = (text) => {
    setShareNotice(text);
    setTimeout(() => setShareNotice(null), NOTICE_MS);
  };

  const refreshProofs = () => getBenchProofs().then((r) => setProofsList(r.proofs)).catch(() => {});

  // The first visit to REPORTS reads what every sub-tab needs, once.
  // The summary is re-read on EVERY open (OVERVIEW or REPORTS) — it used to
  // load once per window, so a set that finished after the first look never
  // appeared (2026-09-26). The route answers 304 when nothing changed.
  const refreshSummary = () => getBenchSummary().then(setSummary).catch(onError);

  const open = () => {
    refreshSummary();
    if (bundles === null) getBenchBundles().then((r) => setBundles(r.bundles)).catch(onError);
    if (proofsList === null) getBenchProofs().then((r) => setProofsList(r.proofs)).catch(onError);
  };

  const onSub = (id) => {
    uiSound('tick');
    setSub(id);
    if (id === 'share' && !shareSource) setShareSource(defaultShareSource(summary));
  };

  const onArtifact = (key, id = selected?.id) => {
    uiSound('tick');
    setArtifact(key);
    if (key === 'report' || !id) return;
    setArtifactLoading(true);
    getBenchBundleArtifact(id, key)
      .then((r) => setArtifactText(r.text))
      .catch((e) => { setArtifactText(null); onError(e); })
      .finally(() => setArtifactLoading(false));
  };

  const onSelect = (item) => {
    uiSound('tick');
    setSelected({ kind: item.kind, id: item.id });
    if (item.kind === 'proof') {
      setProofDetail(null);
      getBenchProof(item.id).then(setProofDetail).catch((e) => { setProofDetail(null); onError(e); });
      return;
    }
    setArtifact('report');
    setArtifactText(null);
    setArtifactLoading(true);
    getBenchBundle(item.id)
      .then((r) => setBundleReport(r.report))
      .catch((e) => { setBundleReport(null); onError(e); })
      .finally(() => setArtifactLoading(false));
  };

  const items = libraryItems(proofsList, bundles, filter);
  const onStep = (dir) => {
    const next = stepLibrary(items, selected, dir);
    if (next) onSelect(next);
  };

  const onShare = (source) => {
    uiSound('open');
    setShareSource(source);
    setSub('share');
  };

  const onExportMd = () => {
    if (!proofDetail?.certificate || selected?.kind !== 'proof') return;
    uiSound('activate');
    downloadBlob(new Blob([proofDetail.certificate], { type: 'text/markdown' }), `neuma-bench-proof-${selected.id}.md`);
  };

  const onExportPdf = async () => {
    if (selected?.kind !== 'proof') return;
    uiSound('activate');
    setProofExportBusy(true);
    try {
      const { blob, filename } = await fetchBenchProofPdf(selected.id);
      downloadBlob(blob, filename);
    } catch (e) {
      onError(e); // BENCH_PRESS_UNAVAILABLE reads here, verbatim
    } finally {
      setProofExportBusy(false);
    }
  };

  const onCopyImage = async () => {
    if (!shareCard) return;
    uiSound('activate');
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': shareCard.blob })]);
      notice('IMAGE COPIED — PASTE IT INTO YOUR POST');
    } catch (e) {
      setShareRefusal(`the clipboard refused the image (${e.message}) — SAVE PNG instead`);
    }
  };

  const onCopyMarkdown = async () => {
    if (!shareCard) return;
    uiSound('activate');
    try {
      await navigator.clipboard.writeText(shareCard.markdown);
      notice('MARKDOWN COPIED — PASTE IT INTO THE THREAD');
    } catch (e) {
      setShareRefusal(`the clipboard refused the text (${e.message})`);
    }
  };

  const onSavePng = () => {
    if (!shareCard) return;
    uiSound('activate');
    downloadBlob(shareCard.blob, shareCard.filename);
  };

  // The atlas's OPEN: REPORTS' explorer, on that benchmark.
  const openSuite = (suiteId) => {
    uiSound('open');
    setSelectedSuite(suiteId);
    setSub('explorer');
  };

  return {
    open,
    refreshSummary,
    openSuite,
    refreshProofs,
    proofsLoaded: proofsList !== null,
    atlas: { summary },
    props: {
      sub,
      onSub,
      explorer: {
        summary,
        selectedSuite,
        onSelectSuite: (id) => { uiSound('tick'); setSelectedSuite(id); },
        selectedSet,
        onSet: (suiteId, id) => { uiSound('tick'); setSelectedSet((m) => ({ ...m, [suiteId]: id })); },
        onShare,
      },
      library: {
        items,
        ready: bundles !== null && proofsList !== null,
        filter,
        onFilter: (f) => { uiSound('tick'); setFilter(f); },
        selected,
        onSelect,
        onStep,
        proof: { ...proofDetail, busy: proofExportBusy, onExportMd, onExportPdf },
        bundle: { artifact, onArtifact, artifactText, report: bundleReport, loading: artifactLoading },
        onShare,
        nowMs,
      },
      share: {
        summary,
        source: shareSource,
        size: shareSize,
        onSource: (value) => { uiSound('tick'); setShareSource(parseShareValue(value)); },
        onSize: (s) => { uiSound('tick'); setShareSize(s); },
        pngUrl: shareCard?.url ?? null,
        markdown: shareCard?.markdown ?? null,
        busy: shareBusy,
        notice: shareNotice,
        refusal: shareRefusal,
        onCopyImage,
        onSavePng,
        onCopyMarkdown,
      },
    },
  };
};
