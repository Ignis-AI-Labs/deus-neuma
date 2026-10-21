// use-residency — the House Clock's […] switch over the
// desk app's residency bridge (electron/residency.cjs via preload). A browser
// has no app to start, so it reads unavailable and the switch is not shown.
// The first charter approval this desk sees switches it on (residency-view.js
// wakesOnApproval), once it takes: a later OFF is the operator's and is never
// undone. A switch that fails is said in the head (error), never swallowed.
//
// impure — the preload bridge, localStorage, React state.

import { useCallback, useEffect, useState } from 'react';
import { APPROVE_WAKES_NOTE, residencyOutcome, wakesOnApproval } from './residency-view.js';

const OFFERED_KEY = 'houseclock:residency-offered';

const bridge = () => (typeof window !== 'undefined' ? window.neuma?.residency ?? null : null);
const wasOffered = () => { try { return localStorage.getItem(OFFERED_KEY) === '1'; } catch { return true; } };
const markOffered = () => { try { localStorage.setItem(OFFERED_KEY, '1'); } catch { /* a desk with no storage asks no more */ } };

/**
 * @returns {{available: boolean, on: ?boolean, offered: boolean, error: ?string, approveNote: ?string,
 *   onToggle: () => Promise<void>, afterApproval: () => Promise<void>}}
 */
export const useResidency = () => {
  const api = bridge();
  const [on, setOn] = useState(null);
  const [offered, setOffered] = useState(wasOffered);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!api) return;
    api.get().then((v) => setOn(Boolean(v)), () => setOn(null));
  }, [api]);

  // impure — ask the desk app; answers whether the change took
  const set = useCallback(async (enabled) => {
    if (!api) return false;
    const outcome = await api.set(enabled).then(
      (v) => residencyOutcome(enabled, { on: Boolean(v) }),
      (err) => residencyOutcome(enabled, { failure: err?.message ?? '' }),
    );
    if (outcome.on !== undefined) setOn(outcome.on);
    setError(outcome.error);
    return outcome.took;
  }, [api]);

  const state = { available: Boolean(api), on, offered, error };
  return {
    ...state,
    approveNote: wakesOnApproval(state) ? APPROVE_WAKES_NOTE : null,
    // the operator's own press: whatever they choose stands, and the first-approval switch is spent
    onToggle: async () => { markOffered(); setOffered(true); await set(!on); },
    // the first approval's switch is spent only once it took: one that failed is offered again
    afterApproval: async () => {
      if (!wakesOnApproval(state) || !(await set(true))) return;
      markOffered();
      setOffered(true);
    },
  };
};
