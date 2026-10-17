// use-files-roots — the FILES tree's roots/git/dir refresh machinery,
// extracted whole from FilesApp (size law). ONE unit by law: the calm git
// poll and the announcement listeners (focus-root, files-changed, project
// activation) ride together with the refreshers they call — the live-watch
// seams were RCA'd, and separating the poll from the listeners is how the
// deaf-desk bug was born. State ownership stays with FilesApp: the hook
// takes the setters and the shared rootsRef; only gitByRoot lives here,
// because refreshGit is its sole writer.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getRoots, listDir, gitStatusMany } from '../../../services/user-files.js';
import { mergeRefreshPlans, gitRootsFor } from './files-refresh-apply.js';
import { createTrailingBatch } from '../../../utils/trailing-batch.js';
import { useSettled } from '../use-settled.js';
import { useVisibleInterval } from '../use-visible-interval.js';

export const useFilesRoots = ({ activeFolder, expanded, setExpanded, rootsRef, setRoots, setNote, setChildrenMap }) => {
  const [gitByRoot, setGitByRoot] = useState({}); // root → { branch, ahead, behind, files } (repos only)
  const rootsRetryRef = useRef(null);
  // In-flight guard: a 14-way probe round on a heavy repo can outlive the
  // 20s poll, and overlapping rounds ACCUMULATE git spawns (audit, 2026-09-02).
  const gitInFlightRef = useRef(false);

  // ONE metered call per round, however many roots are NAMED — a call per
  // root spent the shared bucket (TOO MANY REQUESTS, live 2026-09-25). A
  // root answered null drops its badges (absent = no truth, never invented
  // state); a failed round drops them all. Overlapping rounds refuse.
  const refreshGit = useCallback(async (rootList) => {
    if (gitInFlightRef.current) return;
    if (!rootList || rootList.length === 0) return;
    gitInFlightRef.current = true;
    try {
      const statuses = await gitStatusMany(rootList).then((r) => r?.statuses ?? {}, () => ({}));
      const entries = rootList.map((root) => [root, statuses[root] ?? null]);
      setGitByRoot((prev) => {
        const next = { ...prev };
        for (const [root, status] of entries) {
          if (status?.isRepo) next[root] = status;
          else delete next[root];
        }
        return next;
      });
    } finally {
      gitInFlightRef.current = false;
    }
  }, []);

  const refreshRoots = useCallback(async (attempt = 0) => {
    try {
      const fresh = await getRoots();
      setRoots(fresh);
      refreshGit(fresh);
    } catch (e) {
      setNote(e.message);
      // A 429 mid-storm must not strand the tree on LOADING: wait out the
      // limiter's own window and retry — bounded; past it, the note stands.
      if (e.http === 429 && attempt < 3) {
        const wait = Number.isFinite(e.retryAfterMs) ? e.retryAfterMs : 2000 * (attempt + 1);
        rootsRetryRef.current = setTimeout(() => refreshRoots(attempt + 1), wait);
      }
    }
  }, [refreshGit, setRoots, setNote]);

  useEffect(() => { refreshRoots(); }, [refreshRoots]);
  useEffect(() => () => { if (rootsRetryRef.current) clearTimeout(rootsRetryRef.current); }, []);

  // The working tree moves without us (a commit in the terminal, a pull) —
  // a calm poll keeps the badges current, VS Code-grade. Only while the tree
  // is seen (use-visible-interval.js): a shaded FILES window or a hidden desk
  // spawns no git; returning reads at once.
  useVisibleInterval(() => { refreshGit(rootsRef.current); }, 20000);

  const refreshDir = useCallback(async (dirPath) => {
    try {
      const entries = await listDir(dirPath);
      setChildrenMap((m) => ({ ...m, [dirPath]: entries }));
    } catch (e) { setNote(e.message); }
  }, [setChildrenMap, setNote]);

  // A surface (the stream's DELIVERY desk, the open-folder gesture) registered
  // a root and wants it in front of the witness — even when FILES is already
  // mounted with a stale root list. The root itself was added via the API
  // before this fires.
  useEffect(() => {
    const onFocusRoot = async (e) => {
      const root = e.detail?.root;
      if (!root) return;
      await refreshRoots();
      setExpanded((prev) => new Set(prev).add(root));
      await refreshDir(root);
    };
    window.addEventListener('neuma:files-focus-root', onFocusRoot);
    return () => window.removeEventListener('neuma:files-focus-root', onFocusRoot);
  }, [refreshRoots, refreshDir, setExpanded]);

  // Any files-changed announcement — an editor save, a being's act, or (since
  // the live watch) anything external. A burst rides ONE flush: the live watch
  // re-announces a folded backend frame per path, and answering each with a
  // metered git probe spent the 200/min bucket in seconds — TOO MANY REQUESTS
  // with the tree stranded on LOADING (Founder, live 2026-08-27). The burst folds
  // back: dirs union, and the badges re-probe ONLY the roots that moved —
  // folding events without folding roots still spent 14 metered calls per
  // flush on this desk (audit, 2026-09-02).
  useEffect(() => {
    const batch = createTrailingBatch(async (details) => {
      const plan = mergeRefreshPlans(details, expanded);
      for (const d of plan.dirs) await refreshDir(d);
      if (plan.git) await refreshGit(gitRootsFor(plan, rootsRef.current));
    });
    const onChanged = (e) => batch.push(e.detail);
    window.addEventListener('neuma:files-changed', onChanged);
    return () => {
      window.removeEventListener('neuma:files-changed', onChanged);
      batch.cancel();
    };
  }, [expanded, refreshDir, refreshGit, rootsRef]);

  // When a project is activated, the backend has already added its folder as a
  // root — pull the new roots and focus (expand + lazy-load) that folder.
  useSettled((settled) => {
    if (!activeFolder) return undefined;
    (async () => {
      await refreshRoots();
      if (settled()) return;
      setExpanded((prev) => new Set(prev).add(activeFolder));
      await refreshDir(activeFolder);
    })();
    return undefined;
  }, [activeFolder, refreshRoots, refreshDir]);

  return { gitByRoot, refreshGit, refreshDir };
};
