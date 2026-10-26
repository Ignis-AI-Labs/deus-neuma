// use-marketing-overview.js — the MARKETING overview's ONE read (campaign
// plan §5 […]): the bench, the house's queue, the stats sweep's results, the
// tracked links, and the house social check — read together on open, after
// any act here, and when a being changes the bench. A being's change is
// background news: it waits on the calm gate while the operator works the
// window (calm-gate.js), so tiles never re-lay under the pointer. The accounts and
// companies come from the desk's shared read (use-house-accounts.js); what
// waits on the operator from the desk's one account (use-waiting.js).
//
// impure — network.

import { useCallback, useEffect, useState } from 'react';
import { getCampaigns } from '../../../services/campaigns-client.js';
import { getPostQueue, getChannelBoard } from '../../../services/social-channels-client.js';
import { getResults, getLinks } from '../../../services/marketing-results-client.js';
import { getHouseCheck } from '../../../services/social-check-client.js';
import { useHouseAccounts } from '../accounts/use-house-accounts.js';
import { useWaitingAccount } from '../waiting/use-waiting.js';

const settle = (p) => p.then((value) => ({ value }), (error) => ({ error: error.message }));

/** impure — {data, errors, refresh, loading}; `calm` (use-calm-gate.js) holds a background read while the operator is at the window. */
export const useMarketingOverview = ({ calm = null } = {}) => {
  const house = useHouseAccounts();
  const waiting = useWaitingAccount();
  const [data, setData] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async ({ background = false } = {}) => {
    setLoading(true);
    const [bench, queue, results, links, check, board] = await Promise.all([
      settle(getCampaigns()), settle(getPostQueue()), settle(getResults()), settle(getLinks()), settle(getHouseCheck()),
      settle(getChannelBoard()),
    ]);
    const apply = () => {
      setErrors(Object.fromEntries(Object.entries({ bench, queue, results, links, check }).filter(([, r]) => r.error).map(([k, r]) => [k, r.error])));
      setData({
        campaigns: bench.value?.campaigns || [],
        vocab: { statuses: bench.value?.statuses || [], goalKinds: bench.value?.goalKinds || [], kpiMetrics: bench.value?.kpiMetrics || [] },
        queue: queue.value?.queue || [],
        results: results.value || { posts: {}, unavailable: {}, capability: {}, links: null },
        links: links.value?.links || [],
        site: links.value?.site || null,
        check: check.value?.check || null,
        channels: board.value?.channels || [],
      });
    };
    if (background && calm) calm.offer('overview', apply);
    else apply();
    setLoading(false);
  }, [calm]);

  useEffect(() => { refresh().catch(() => setLoading(false)); }, [refresh]);
  useEffect(() => {
    const onChanged = () => { refresh({ background: true }).catch(() => {}); };
    window.addEventListener('neuma:campaigns-changed', onChanged);
    return () => window.removeEventListener('neuma:campaigns-changed', onChanged);
  }, [refresh]);

  return { data, errors, loading, refresh, accounts: house.accounts, companies: house.companies, known: house.known, houseError: house.error, waiting: waiting?.account || null };
};
