// use-lead-engine.js — the LEAD ENGINE section's state: the engine as the
// server holds it, and the operator's presses (move a segment, approve its
// list, approve or return the facts sheet, add to the do-not-contact list), each followed by a fresh read. Every failure
// is surfaced, never swallowed.
// impure — talks to the backend through revenue-client.js.

import { useCallback, useEffect, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { announceWaitingChanged } from '../waiting/waiting-changed.js';
import { getLeadEngine, setSegmentState, suppressContact, approveSegmentList, reviewSalesFacts, openSalesCampaign, moveSalesCampaign, setAudienceCampaign, setLeadSpend, changeSalesFact, setLeadKind } from '../../../services/revenue-client.js';

export const useLeadEngine = () => {
  const [engine, setEngine] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setEngine(await getLeadEngine());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const press = async (fn, said) => {
    uiSound('activate');
    setBusy(true);
    try {
      await fn();
      setNotice(said);
      announceWaitingChanged(); // WAITING ON YOU and the POSITIONS board read again at once
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return {
    engine, busy, error, notice,
    refresh: () => { uiSound('activate'); load(); },
    moveSegment: (segment, state) => press(() => setSegmentState(segment.id, state), `"${segment.name}" is ${state}.`),
    approveList: (segment, count) => press(() => approveSegmentList(segment.id), `${count} compan${count === 1 ? 'y' : 'ies'} on "${segment.name}" approved for outreach.`),
    reviewFacts: (sheet, verdict, note, only) => press(() => reviewSalesFacts(sheet.id, verdict, note, only), verdict !== 'approved' ? 'The facts sheet went back to the sales seat with your note.' : only && only.length < sheet.facts.length ? `${only.length} fact(s) approved. The other ${sheet.facts.length - only.length} went back to the sales seat to fix.` : 'The facts sheet is approved: emails to leads may now go, checked against it.'),
    openCampaign: (draft) => press(() => openSalesCampaign({ name: draft.name.trim(), company: draft.company, goal: draft.goal.trim() }), `"${draft.name.trim()}" is open.`),
    moveCampaign: (campaign, change, said) => press(() => moveSalesCampaign(campaign.id, change), said),
    changeFact: (sheet, change, said) => press(() => changeSalesFact(sheet.id, change), said),
    refileLead: (lead, kind) => press(() => setLeadKind(lead.id, kind), `${lead.name || lead.contact} is now filed under ${kind}.`),
    setSpend: (mode, cap) => press(() => setLeadSpend(mode, cap), `Paid lead data: ${{ ask: 'the seat asks you first', 'free-first': 'free first', 'paid-first': 'paid from the start' }[mode]}, at most ${cap} credit(s) a month.`),
    putAudience: (segment, campaign) => press(() => setAudienceCampaign(segment.id, campaign.id), `"${segment.name}" now serves "${campaign.name}".`),
    suppress: (target, reason) => press(() => suppressContact(target.trim(), reason), `${target.trim()} is on the do-not-contact list.`),
  };
};
