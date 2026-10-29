// use-update-bar — what the desk app says about updates, over the preload bridge
// (electron/update-bar.cjs via window.neuma.update). A browser tab has no app to update,
// so it reads nothing and the bar never shows.
//
// impure — the preload bridge and React state.

import { useCallback, useEffect, useState } from 'react';

const bridge = () => (typeof window !== 'undefined' ? window.neuma?.update ?? null : null);

/**
 * @returns {{ view: ?{ current: string, bar: ?object, whatsNew: ?object },
 *   pending: ?string, refused: ?string, act: (action: string) => Promise<void> }}
 */
export const useUpdateBar = () => {
  const api = bridge();
  const [view, setView] = useState(null);
  const [pending, setPending] = useState(null);
  const [refused, setRefused] = useState(null);

  useEffect(() => {
    if (!api) return undefined;
    let alive = true;
    api.state().then((v) => { if (alive) setView(v); }, () => {});
    const off = api.onChange((v) => { setView(v); setRefused(null); });
    return () => { alive = false; off(); };
  }, [api]);

  // impure — the one act the person chose; a refusal is said, never swallowed
  const act = useCallback(async (action) => {
    if (!api) return;
    setPending(action);
    setRefused(null);
    const outcome = await api.act(action).catch((error) => ({ ok: false, reason: error?.message || 'the app did not answer' }));
    setPending(null);
    if (!outcome?.ok) setRefused(outcome?.reason || 'the app could not do that');
  }, [api]);

  return { view, pending, refused, act };
};
