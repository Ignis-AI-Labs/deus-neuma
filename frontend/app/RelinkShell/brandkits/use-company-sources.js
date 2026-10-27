// use-company-sources — one company's SITE & CODE as the server holds it, and
// every way the owner changes it: the repos list, the proposals, and the
// CMO's read of each repo.
//
// impure — network.

import { useCallback, useEffect, useState } from 'react';
import {
  getCompanySources, setCompanyRepos, getRepoProposals, grantRepoRead, revokeRepoRead,
} from '../../../services/company-sources-client.js';

/**
 * impure — {company, cmo, error, notice, busy, proposals, run, saveRepos, propose, setProposals, grant, revoke}
 * @param {string} companyId
 */
export const useCompanySources = (companyId) => {
  const [read, setRead] = useState({ company: undefined, cmo: null, error: null });
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState(null);

  const reload = useCallback(async () => {
    try {
      const out = await getCompanySources();
      setRead({ company: out.companies.find((c) => c.id === companyId) || null, cmo: out.cmo, error: null });
    } catch (e) {
      setRead((r) => ({ ...r, error: e.message }));
    }
  }, [companyId]);

  useEffect(() => { setProposals(null); setNotice(null); reload(); }, [reload]);

  // impure — run one change, then read the truth back; the notice says how it went.
  const act = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      setNotice({ tone: 'ok', text: done });
      await reload();
      return true;
    } catch (e) {
      setNotice({ tone: 'bad', text: e.message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    ...read,
    notice,
    busy,
    proposals,
    setProposals,
    // Any other change to this company's sources (a link change decided): run it, read the truth back.
    run: act,
    saveRepos: (repos, done) => act(() => setCompanyRepos(companyId, repos), done),
    grant: (path) => act(() => grantRepoRead(companyId, path), `The CMO can read ${path} now — read only.`),
    revoke: (path) => act(() => revokeRepoRead(companyId, path), `The CMO's read of ${path} is taken back.`),
    propose: async () => {
      setBusy(true);
      try {
        const out = await getRepoProposals(companyId);
        setProposals(out.proposals.map((p) => ({ ...p, ticked: p.strong })));
        setNotice(out.proposals.length ? null : { tone: 'ok', text: `No more repos that look like this company's beside this app${out.scanned ? ` (in ${out.scanned})` : ''}.` });
      } catch (e) {
        setNotice({ tone: 'bad', text: e.message });
      } finally {
        setBusy(false);
      }
    },
  };
};
