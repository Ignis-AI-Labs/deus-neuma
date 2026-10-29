// CompanyLineApp — THE COMPANY LINE WINDOW: the house founding its companies,
// one stage, one master (docs/planning/proposals/governance/house-company-line.md).
// It stands in the WORK band beside the HOUSE CLOCK.
//
// The operator's acts here: open a company, hand on a stage they master,
// answer an inspection that waits on them (accept, return with the flaw
// named, or end the gap where the stage allows it). The dial itself is set in
// the HOUSE CLOCK's charter; this window shows it and opens the way there.
//
// impure shell only: every render decision lives in CompanyLineBody.jsx and
// company-line-view.js (pure, node-renderable).

import { useCallback, useEffect, useState } from 'react';
import { AppTitle } from '../app-title.jsx';
import { uiSound } from '../../../services/ui-sound.js';
import { getCompanyLines, openCompany, handOnStage, inspectStage, answerHands } from '../../../services/company-line-client.js';
import { getRosterForBinding } from '../../../services/social-channels-client.js';
import { useWaitingAccount } from '../waiting/use-waiting.js';
import { requestWaitingJump } from '../waiting/waiting-jump.js';
import { CompanyLineBody, CompanyLineIcon } from './CompanyLineBody.jsx';
import { handOnPayload } from './company-line-view.js';

const CompanyLineAppBody = () => {
  const [board, setBoard] = useState(null);
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState({});
  const waiting = useWaitingAccount();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await getCompanyLines());
      setError(null);
    } catch (e) {
      setError(e.message); // surfaced, never swallowed
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    getRosterForBinding()
      .then((r) => setNames(Object.fromEntries(r.filter((p) => p.participantKind === 'neuma').map((p) => [p.neumaId, p.name || p.neumaId]))))
      .catch((e) => setError(e.message));
  }, [load]);

  const onDraft = (key, field, value) => setDrafts((d) => ({ ...d, [key]: { ...(d[key] ?? {}), [field]: value } }));

  // One move on the server, then the line and the desk's account read again.
  const move = async (key, fn) => {
    uiSound('activate');
    setBusy(true);
    try {
      await fn();
      setDrafts((d) => ({ ...d, [key]: {} }));
      await Promise.all([load(), waiting?.refresh?.()]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cline-root">
      <CompanyLineBody
        board={board} names={names} error={error} loading={loading} busy={busy} drafts={drafts} onDraft={onDraft}
        onRefresh={() => { uiSound('activate'); load(); }}
        onOpen={() => move('_open', () => openCompany({ name: drafts._open?.name, mode: drafts._open?.mode }))}
        onHandOn={(c) => move(c.id, () => handOnStage(c.id, handOnPayload(c, drafts[c.id] ?? {})))}
        onInspect={(c, verdict) => move(c.id, () => inspectStage(c.id, { stage: c.stage, verdict, flaw: drafts[c.id]?.flaw }))}
        onAnswer={(item, status) => move(item.id, () => answerHands(item.company.id, item.id, { status, text: drafts[item.id]?.text }))}
        onCharter={() => { uiSound('open'); requestWaitingJump({ where: { app: 'houseclock', tab: 'charter' } }); }}
      />
    </div>
  );
};

export const companyLineApp = {
  label: 'COMPANY LINE',
  labelKey: 'apps.companyline',
  icon: <CompanyLineIcon />,
  title: <AppTitle label="COMPANY LINE" labelKey="apps.companyline" />,
  Body: CompanyLineAppBody,
  storageKey: 'companyline',
};
