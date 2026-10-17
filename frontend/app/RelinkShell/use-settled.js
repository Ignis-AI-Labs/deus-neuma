// use-settled — the async-effect guard, once. impure (it IS the effect).
// The caller's effect body receives settled(), answering […] — true after cleanup, so a late-resolving promise
// never writes state into a superseded or unmounted run:
//
//   useSettled((settled) => {
//     load().then((r) => { if (settled()) return; setState(r); });
//     return optionalCleanup;
//   }, [deps]);
//
// The guard is a fresh closure per effect RUN, not a component-level ref:
// on a dep change the old run's guard stays tripped even after the next run
// begins — a shared ref would flip back to unsettled with the new run and
// reopen the exact race this guard exists to close (a previous being's late
// fetch overwriting the current one's state). Guards that must live outside
// one effect's closure (read from event handlers or sibling effects) cannot
// use this hook — keep a component-level useRef for those.

import { useEffect } from 'react';

export const useSettled = (effect, deps) => {
  useEffect(() => {
    let settled = false;
    const cleanup = effect(() => settled);
    return () => { settled = true; if (cleanup) cleanup(); };
  }, deps);
};
