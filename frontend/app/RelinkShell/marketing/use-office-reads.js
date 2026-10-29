// use-office-reads — the two reads the MARKETING board's new panels make on
// their own (marketing-office-client.js): the house's locked weekly plan (CMO
// LOG) and what changed in one company (COMPANY WATCH). Each reads when its
// panel first draws, and again whenever the window's one read is re-read
// (`stamp`); a re-read is background news, so it waits on the calm gate while
// the operator is at the window (calm-gate.js) — nothing moves under the
// pointer.
//
// impure — network.

import { useEffect, useRef, useState } from 'react';
import { getWeeklyPlan, getCompanyWatch } from '../../../services/marketing-office-client.js';

/**
 * impure — {ready, value, error} of one read, keyed by what it reads.
 * @param {() => Promise<object>} load
 * @param {{key: string, stamp: unknown, calm: ?{offer: Function}}} opts
 */
const useOfficeRead = (load, { key, stamp, calm }) => {
  const [state, setState] = useState({ key: null, value: null, error: null });
  const landed = useRef(null);
  // The read is named by its key: the latest loader is used, and a new key reads anew.
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let live = true;
    loader.current().then((value) => {
      if (!live) return;
      const apply = () => { landed.current = key; setState({ key, value, error: null }); };
      if (landed.current === key && calm) calm.offer(`office:${key}`, apply);
      else apply();
    }, (err) => { if (live) setState((s) => ({ ...s, key, error: err.message })); });
    return () => { live = false; };
  }, [key, stamp, calm]);
  return { ready: state.key === key && (state.value !== null || state.error !== null), value: state.key === key ? state.value : null, error: state.key === key ? state.error : null };
};

/** impure — the house's locked weekly plan and the CMO's board arrangements: {ready, plan, board, error}. */
export const useWeeklyPlan = ({ stamp, calm }) => {
  const r = useOfficeRead(() => getWeeklyPlan(), { key: 'plan', stamp, calm });
  return { ready: r.ready, plan: r.value?.plan ?? null, board: r.value?.board ?? null, error: r.error };
};

/** impure — what changed in one company: {ready, watch, error}. */
export const useCompanyWatch = (companyId, { stamp, calm }) => {
  const r = useOfficeRead(() => getCompanyWatch(companyId), { key: `watch:${companyId}`, stamp, calm });
  return { ready: r.ready, watch: r.value?.watch ?? null, error: r.error };
};
