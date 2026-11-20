// use-files-watch — impure: the desk's ear on the backend files watcher.
// Reconnects with a fresh exact-lane ticket rather than a bearer in the URL.

import { useEffect } from 'react';
import { deskTicketUrl } from '../../services/desk-tickets.js';

export const useFilesWatch = () => {
  useEffect(() => {
    let source = null;
    let retryTimer = null;
    let pollTimer = null;
    let connecting = false;
    const onFrame = (e) => {
      let frame;
      try { frame = JSON.parse(e.data); } catch { return; }
      for (const p of Array.isArray(frame?.paths) ? frame.paths : []) {
        window.dispatchEvent(new CustomEvent('neuma:files-changed', { detail: { path: p } }));
      }
      for (const root of Array.isArray(frame?.bulk) ? frame.bulk : []) {
        window.dispatchEvent(new CustomEvent('neuma:files-changed', { detail: { bulk: root } }));
      }
      if (frame?.git && !frame.paths?.length && !frame.bulk?.length) {
        window.dispatchEvent(new CustomEvent('neuma:files-changed', { detail: { git: true } }));
      }
    };
    const schedule = (ms) => {
      if (retryTimer || source || connecting) return;
      retryTimer = setTimeout(() => { retryTimer = null; subscribe(); }, ms);
    };
    const subscribe = async () => {
      if (connecting || source || !sessionStorage.getItem('authToken')) return;
      connecting = true;
      try {
        const url = await deskTicketUrl('/api/v1/user/files/events');
        source = new EventSource(url);
        source.onmessage = onFrame;
        source.onerror = () => {
          source?.close();
          source = null;
          schedule(1000);
        };
      } catch {
        schedule(2000);
      } finally {
        connecting = false;
      }
    };
    subscribe();
    pollTimer = setInterval(subscribe, 2000);
    return () => {
      clearInterval(pollTimer);
      clearTimeout(retryTimer);
      source?.close();
    };
  }, []);
};
