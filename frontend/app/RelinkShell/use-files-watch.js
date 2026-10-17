// use-files-watch — impure: the desk's ear on the backend files watcher.
//
// Subscribes the SSE lane (`/api/v1/user/files/events`) and re-announces every
// frame on the existing `neuma:files-changed` window bus, so the FILES tree,
// open editor buffers, and the Explorer's git badge follow EXTERNAL changes
// (the terminal, git, another process) exactly as they already follow the
// desk's own acts. One subscriber per desk — mounted at the shell, not per
// window. EventSource reconnects itself after a dropped backend.

import { useEffect } from 'react';

export const useFilesWatch = () => {
  useEffect(() => {
    // The session token rides the query — an EventSource cannot carry a
    // header; the route maps it in before requireAuth (the /raw law).
    //
    // The token can land AFTER the shell mounts (a cold desk boot auths
    // async). A mount-time bail left the desk PERMANENTLY deaf to the watch
    // lane — and since watchers start on the first subscriber, nothing was
    // watched at all (Design note, 2026-08-16: Dolphin emptied a folder, the tree
    // kept showing it). Poll until the token exists, then subscribe once.
    let source = null;
    let timer = null;
    const onFrame = (e) => {
      let frame;
      try { frame = JSON.parse(e.data); } catch { return; /* comment/garbage frame */ }
      for (const p of Array.isArray(frame?.paths) ? frame.paths : []) {
        window.dispatchEvent(new CustomEvent('neuma:files-changed', { detail: { path: p } }));
      }
      for (const root of Array.isArray(frame?.bulk) ? frame.bulk : []) {
        window.dispatchEvent(new CustomEvent('neuma:files-changed', { detail: { bulk: root } }));
      }
      // .git internals alone: the badges re-probe, no dir re-lists.
      if (frame?.git && !frame.paths?.length && !frame.bulk?.length) {
        window.dispatchEvent(new CustomEvent('neuma:files-changed', { detail: { git: true } }));
      }
    };
    const subscribe = () => {
      const token = sessionStorage.getItem('authToken');
      if (!token) return false;
      source = new EventSource(`/api/v1/user/files/events?token=${encodeURIComponent(token)}`);
      source.onmessage = onFrame;
      return true;
    };
    if (!subscribe()) {
      timer = setInterval(() => {
        if (subscribe()) { clearInterval(timer); timer = null; }
      }, 2000);
    }
    return () => {
      if (timer) clearInterval(timer);
      source?.close();
    };
  }, []);
};
