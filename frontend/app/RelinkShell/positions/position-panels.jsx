// position-panels — each function of each position, rendered IN PLACE from the
// screen that already exists (docs/design/interface/position-hubs-plan.md:
// nothing is rewritten and nothing is lost). A function whose screen is a
// large window of its own opens through a door until its body moves in.
// impure — the small wrappers read their own board.

import { useCallback, useEffect, useState } from 'react';
import { staffApp } from '../StaffApp.jsx';
import { legalApp } from '../LegalApp.jsx';
import { securityApp } from '../SecurityApp.jsx';
import { treasuryApp } from '../TreasuryApp.jsx';
import { LeadEngineSection } from '../company-line/LeadEngineSection.jsx';
import { SalesCampaigns } from '../company-line/SalesCampaigns.jsx';
import { LeadImport } from '../company-line/LeadImport.jsx';
import { CampaignLinks } from './CampaignLinks.jsx';
import { BusinessModel } from './BusinessModel.jsx';
import { SalesSection } from '../company-line/SalesSection.jsx';
import { BooksSection } from '../company-line/BooksSection.jsx';
import { EmailSection } from '../EmailSection.jsx';
import { getRevenueBoard, setDeliveryDestination } from '../../../services/revenue-client.js';
import { getAccountsBoard } from '../../../services/accounts-client.js';
import { getEmailBoard } from '../../../services/email-client.js';
import { useWindows } from '../../windowing/use-windows.js';
import { MARKETING_WINDOW } from '../../windowing/retired-windows.js';
import { uiSound } from '../../../services/ui-sound.js';
import '../company-line/CompanyLine.css';

// impure — one board read, re-read on demand; the error is shown, never swallowed.
const useBoard = (read) => {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => read().then((b) => { setBoard(b); setError(null); }, (e) => setError(e.message)), [read]);
  useEffect(() => { load(); }, [load]);
  return { board, error, load };
};

const Failed = ({ error }) => (error ? <p className="sec-error" role="alert">{error}</p> : null);

const Deals = ({ names }) => {
  const { board, error, load } = useBoard(getRevenueBoard);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const onDestination = async () => {
    uiSound('activate');
    setBusy(true);
    try {
      await setDeliveryDestination(String(drafts._delivery?.folder ?? '').trim(), String(drafts._delivery?.linkBase ?? '').trim());
      setDrafts({});
      setFailed(null);
      await load();
    } catch (e) { setFailed(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="cline">
      <Failed error={error || failed} />
      <SalesSection sales={board} names={names} busy={busy} seatless drafts={drafts}
        onDraft={(key, field, value) => setDrafts((d) => ({ ...d, [key]: { ...(d[key] ?? {}), [field]: value } }))} onDestination={onDestination} />
    </div>
  );
};

const Books = ({ names }) => {
  const { board, error } = useBoard(getAccountsBoard);
  return <div className="cline"><Failed error={error} /><BooksSection books={board} names={names} seatless /></div>;
};

const Mailbox = () => {
  const read = useCallback(() => getEmailBoard().then((b) => b.account), []);
  const { board, error, load } = useBoard(read);
  const [openKey, setOpenKey] = useState(null);
  return <EmailSection account={board} error={error} onChanged={load} openKey={openKey} onOpen={setOpenKey} />;
};

// A function that still lives in a window of its own: one door, opened on it.
const Door = ({ app, label, what }) => {
  const { dispatch } = useWindows();
  return (
    <div className="pos-door">
      <p className="pos-covers">{what}</p>
      <button type="button" className="sec-scan label-data" onClick={() => { uiSound('open'); dispatch({ type: 'OPEN', id: app }); }}>OPEN {label}</button>
    </div>
  );
};

const body = (app) => () => <app.Body />;
const door = (app) => ({ fn }) => <Door app={app} label={fn.label} what={fn.what} />;

// COMPANY: what is true of each company, together — its business model, then the facts a buyer may be told.
// The facts are the sales seat's to file, so ASK reaches that seat's holder only from the SALES position.
const Company = ({ office, ...props }) => (
  <div className="cline">
    <BusinessModel {...props} />
    <LeadEngineSection parts={['facts']} holder={office === 'cro' ? props.holder : null} onHand={office === 'cro' ? props.onHand : null} />
  </div>
);

const PANELS = Object.freeze({
  'cos.model': Company, 'cro.model': Company, 'cmo.model': Company,
  'cos.staff': body(staffApp), 'cos.clock': door('houseclock'),
  'cro.campaigns': () => <div className="cline"><SalesCampaigns /></div>,
  // Each marketing campaign once: what it is, what it works with, and one press onto its own page in MARKETING.
  'cmo.campaigns': ({ onDoor }) => <div className="cline"><CampaignLinks office="cmo" onOpen={onDoor ? (c) => onDoor({ kind: 'marketing', campaignId: c.id }) : null} /></div>,
  // ALL PEOPLE on the sales hub: everyone the house knows and the do-not-contact list; the outbox is the EMAILS stage.
  'cro.leads': ({ holder, onHand }) => <div className="cline"><LeadImport /><LeadEngineSection parts={['people']} holder={holder} onHand={onHand} /></div>, 'cro.deals': Deals, 'cro.mailbox': Mailbox,
  'cmo.marketing': door(MARKETING_WINDOW), 'cmo.gallery': door('gallery'),
  'clo.legal': body(legalApp), 'cso.security': body(securityApp),
  'cfo.treasury': body(treasuryApp), 'cfo.wallet': door('wallet'),
  'cao.books': Books,
});

/** One function of one position, in place. @param {{office: string, fn: object, names: Record<string, string>, holder?: ?object, onHand?: Function, onChanged?: Function}} props */
export const PositionPanel = ({ office, fn, names, holder = null, onHand, onChanged, onDoor }) => {
  const Panel = PANELS[`${office}.${fn.id}`];
  return Panel ? <Panel office={office} fn={fn} names={names} holder={holder} onHand={onHand} onChanged={onChanged} onDoor={onDoor} /> : <p className="pos-covers">{fn.what}</p>;
};
