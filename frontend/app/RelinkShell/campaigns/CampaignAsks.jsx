// CampaignAsks — the campaign as the shared page between the operator and
// the CMO (campaign plan §3.2): the asks both ways. What waits on you stands
// open (◇, the desk's "waits on you" mark) with its answer in place; your own
// open asks stand beside it with WITHDRAW; settled asks are inventory, behind
// a `SETTLED n` count door. The change log is its own door (CampaignLog.jsx).

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { askOnCampaign, settleCampaignAsk } from '../../../services/campaigns-client.js';

const when = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? '' : new Date(t).toLocaleString();
};

const AskRow = ({ ask, busy, onSettle }) => {
  const [answer, setAnswer] = useState('');
  const theirs = ask.from === 'cmo';
  return (
    <div className={`campaign-ask is-${ask.state}`} data-ask={ask.id}>
      <div className="settings-row">
        <span className="settings-k" title={theirs ? 'the CMO asks you' : 'you asked the CMO'}>{theirs ? '◇ CMO ASKS' : 'YOU ASKED'}</span>
        <span className="settings-v" data-own-words>{ask.text}</span>
      </div>
      <p className="settings-note">{when(ask.at)}{ask.state === 'done' ? ` · settled ${when(ask.doneAt)}${ask.answer ? ` — ${ask.answer}` : ''}` : ''}</p>
      {ask.state === 'open' ? (
        <div className="settings-control">
          {theirs ? (
            <input className="settings-input" placeholder="Your answer" aria-label="Your answer"
              value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={busy} />
          ) : null}
          <button type="button" className="settings-set" disabled={busy || (theirs && !answer.trim())}
            onClick={() => onSettle(ask.id, answer.trim())}>
            {theirs ? 'ANSWER' : 'WITHDRAW'}
          </button>
        </div>
      ) : null}
    </div>
  );
};

export const CampaignAsks = ({ campaign, onChanged }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showSettled, setShowSettled] = useState(false);
  const asks = campaign.asks || [];
  // What waits on you first, then your own open asks.
  const open = asks.filter((a) => a.state === 'open').sort((a, b) => (a.from === b.from ? 0 : a.from === 'cmo' ? -1 : 1));
  const settled = asks.filter((a) => a.state !== 'open');

  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try { await fn(); await onChanged(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const settle = (askId, answer) => act(() => settleCampaignAsk(campaign.id, askId, answer));

  return (
    <div data-campaign-asks>
      <div className="label-data settings-h">ASKS</div>
      {open.map((a) => <AskRow key={a.id} ask={a} busy={busy} onSettle={settle} />)}
      {settled.length ? (
        <div className="settings-control">
          <button type="button" className="settings-set" data-settled-door aria-expanded={showSettled}
            onClick={() => { uiSound('toggle'); setShowSettled(!showSettled); }}>
            SETTLED {settled.length}
          </button>
        </div>
      ) : null}
      {showSettled ? settled.map((a) => <AskRow key={a.id} ask={a} busy={busy} onSettle={settle} />) : null}
      <div className="settings-control">
        <input className="settings-input" placeholder="Ask the CMO…" aria-label="Ask the CMO"
          value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
        <button type="button" className="settings-set" disabled={busy || !text.trim()}
          onClick={() => act(async () => { await askOnCampaign(campaign.id, text.trim()); setText(''); })}>
          ASK
        </button>
      </div>
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};
