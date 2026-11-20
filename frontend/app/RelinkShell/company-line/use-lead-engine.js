// use-lead-engine.js — the LEAD ENGINE section's state: the engine as the
// server holds it, and the operator's presses (move a segment, approve its
// list, approve or return the facts sheet, add to the do-not-contact list), each followed by a fresh read. Every failure
// is surfaced, never swallowed.
// impure — talks to the backend through revenue-client.js.

import { useCallback, useEffect, useRef, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { announceWaitingChanged, onWaitingChanged } from '../waiting/waiting-changed.js';
import { runSendBatch } from './outbox-send.js';
import { checkOutboxAddresses, confirmOutboxAddresses, reviewCampaignEmailPlan, sendOutbox, returnOutboxEmail, editOutboxEmail, deleteOutboxEmails, handProspect, passCandidate, readSegmentSites, getLeadEngine, setSegmentState, suppressContact, liftSuppression, approveSegmentList, reviewSalesFacts, openSalesCampaign, moveSalesCampaign, setAudienceCampaign, changeSalesFact, setLeadKind, setLeadSaid } from '../../../services/revenue-client.js';

export const useLeadEngine = () => {
  const [engine, setEngine] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  // A batch of emails being sent, one at a time so each row says where it stands as it changes (outbox-view.js sendingView).
  const [sending, setSending] = useState(null);
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setEngine(await getLeadEngine());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Read again whenever anything changed for the house by any door: a member filing a lead or an audience,
  // a decision taken in another window (the backend's pulse, passed on by use-waiting.js).
  useEffect(() => onWaitingChanged(() => { load(); }), [load]);

  const press = async (fn, said) => {
    uiSound('activate');
    setBusy(true);
    try {
      const result = await fn();
      setNotice(typeof said === 'function' ? said(result) : said);
      announceWaitingChanged(); // WAITING ON YOU and the POSITIONS board read again at once
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // impure — send the emails one after another (Design note, 2026-11-19: […]): the row being sent says SENDING…, each one done says SENT or NOT SENT and why, the WAITING ON YOU
  // count follows each, and STOP ends it after the one in flight. The ones not reached stay in the outbox, unsent.
  const sendBatch = async (ids) => {
    if (!ids.length || (sending && !sending.done)) return;
    uiSound('activate');
    stopRef.current = false;
    setNotice('');
    const rows = ids.map((id) => (engine?.outbox?.drafts ?? []).find((d) => d.id === id)).filter(Boolean);
    await runSendBatch({
      ids: rows.map((d) => d.id), send: sendOutbox, stopped: () => stopRef.current,
      onStep: (state) => {
        setSending({ ...state, rows });
        if (!state.current && !state.done && Object.keys(state.results).length) announceWaitingChanged();
      },
    });
    await load();
  };

  return {
    engine, busy, error, notice,
    sending, stopSending: () => { stopRef.current = true; }, clearSending: () => setSending(null),
    refresh: () => { uiSound('activate'); load(); },
    moveSegment: (segment, state) => press(() => setSegmentState(segment.id, state), `"${segment.name}" is ${state}.`),
    readSites: (segment) => press(() => readSegmentSites(segment.id), (r) => `${r.read} site${r.read === 1 ? '' : 's'} read for "${segment.name}": ${r.alive} alive, ${r.read - r.alive} with no site. ${r.left} still unread.`),
    sendEmails: (ids) => sendBatch(ids),
    // SEND ANYWAY: one email whose address no database confirmed live, sent by the operator knowing it may bounce.
    sendAnyway: (draft) => press(() => sendOutbox([draft.id], { acceptRisk: true }), (r) => (r.sent.length ? `Sent to ${draft.to.join(', ')}, unconfirmed — if it bounces, it shows under SENT as BOUNCED.` : `Not sent: ${r.refused.map((x) => x.reason).join(' · ')}`)),
    returnEmail: (draft, note) => press(() => returnOutboxEmail(draft.id, note), `The email to ${draft.to.join(', ')} went back to your sales member with your note.`),
    // The operator's hands on a company in VALIDATE: drop it, take it off the approved list, move it, or pass one not scored yet.
    handCompany: (company, change, said) => press(() => handProspect(company.id, change), said),
    passCompany: (company, why) => press(() => passCandidate(company.segmentId, company.domain, why), `${company.name} is passed over: it leaves the companies to validate.`),
    checkEmails: (ids, opts = {}) => press(() => checkOutboxAddresses(ids, opts), (r) => (r.every
      ? `${r.asked} database check${r.asked === 1 ? '' : 's'} run. ${r.addresses.map((x) => `${x.email}: ${x.status ? x.status.toUpperCase() : 'NOT CHECKED'}, confirmed by ${x.confirmedBy.length ? x.confirmedBy.join(' + ') : 'none'}`).join(' · ')}${r.problems.length ? ` — NOT RUN: ${r.problems.join(' · ')}` : ''}`
      : `${r.checked} email${r.checked === 1 ? '' : 's'} checked and fine to send.${r.refused.length ? ` ${r.refused.length} NOT: ${r.refused.map((x) => x.reason).join(' · ')}` : ''}`)),
    // FIND CONFIRMED ADDRESSES: how many were confirmed, moved to a confirmed address, or settled as unconfirmable.
    confirmEmails: (ids) => press(() => confirmOutboxAddresses(ids), (r) => {
      const n = (o) => r.results.filter((x) => x.outcome === o).length;
      const moved = r.results.filter((x) => x.outcome === 'found');
      return `${n('confirmed')} confirmed by another database. ${moved.length} moved to a confirmed address${moved.length ? ` (${moved.map((x) => `${x.email} → ${x.to}`).join(', ')})` : ''}. ${n('settled')} NO DATABASE CAN CONFIRM — marked, nobody asks again; send them as they are or write to someone else.`;
    }),
    reviewEmailPlan: (campaign, verdict, note) => press(() => reviewCampaignEmailPlan(campaign.id, verdict, note), verdict === 'approved'
      ? `The email plan of "${campaign.name}" is locked in: its first emails are written from it.` : `The email plan of "${campaign.name}" went back to your sales member with your note.`),
    deleteEmails: (ids) => press(() => deleteOutboxEmails(ids), (r) => `${r.deleted.length} email${r.deleted.length === 1 ? '' : 's'} deleted: never sent, off the list.${r.missing.length ? ` ${r.missing.length} no longer waited.` : ''}`),
    editEmail: (draft, change) => press(() => editOutboxEmail(draft.id, change), `The email to ${draft.to.join(', ')} is changed. It still waits for you to send it.`),
    approveList: (segment, ids) => press(() => approveSegmentList(segment.id, ids), `${ids.length} compan${ids.length === 1 ? 'y' : 'ies'} on "${segment.name}" approved for outreach.`),
    reviewFacts: (sheet, verdict, note, only) => press(() => reviewSalesFacts(sheet.id, verdict, note, only), verdict !== 'approved' ? 'The facts sheet went back to the sales seat with your note.' : only && only.length < sheet.facts.length ? `${only.length} fact(s) approved. The other ${sheet.facts.length - only.length} went back to the sales seat to fix.` : 'The facts sheet is approved: emails to leads may now go, checked against it.'),
    openCampaign: (draft) => press(() => openSalesCampaign({ name: draft.name.trim(), company: draft.company, goal: draft.goal.trim() }), `"${draft.name.trim()}" is open.`),
    moveCampaign: (campaign, change, said) => press(() => moveSalesCampaign(campaign.id, change), said),
    changeFact: (sheet, change, said) => press(() => changeSalesFact(sheet.id, change), said),
    // What a reply says, set by hand when the rules read it wrong: a no goes to SAID NO (kept as a contact), anything else comes back to REPLIES.
    readReplyAs: (lead, says) => press(() => setLeadSaid(lead.id, says), `${lead.name || lead.contact}: ${{ no: 'marked as a no. Nothing more is written to them; the contact is kept.', gone: 'marked as having left. Nothing more is written to that address.', wants: 'marked as asking for something. It is first in REPLIES.', open: 'back in REPLIES to be read.', auto: 'marked as an automatic reply.' }[says]}`),
    refileLead: (lead, kind) => press(() => setLeadKind(lead.id, kind), `${lead.name || lead.contact} is now filed under ${kind}.`),
    putAudience: (segment, campaign) => press(() => setAudienceCampaign(segment.id, campaign.id), `"${segment.name}" now serves "${campaign.name}".`),
    suppress: (target, reason) => press(() => suppressContact(target.trim(), reason), `${target.trim()} is on the do-not-contact list.`),
    lift: (entry) => press(() => liftSuppression(entry.value), `${entry.value} is off the do-not-contact list. A lead it closed stays closed until you reopen it.`),
  };
};
