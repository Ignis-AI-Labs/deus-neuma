import { useEffect, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';

const money = (value) => `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const WalletCapitalControls = ({ capital, vault, busy, onSave }) => {
  const [action, setAction] = useState(String(capital.maxActionUsd));
  const [daily, setDaily] = useState(String(capital.dailyNotionalUsd));
  useEffect(() => {
    setAction(String(capital.maxActionUsd));
    setDaily(String(capital.dailyNotionalUsd));
  }, [capital.maxActionUsd, capital.dailyNotionalUsd]);

  return (
    <section className="lpw-card" aria-label="Capital controls">
      <div className="lpw-row">
        <h3 className="lpw-h">CAPITAL CONTROLS</h3>
        <span className="lpw-chip">{capital.privateBroadcastRequired ? 'PRIVATE BROADCAST REQUIRED' : 'PUBLIC BROADCAST ALLOWED'}</span>
      </div>
      <p className="lpw-sub" role="status">
        {capital.paused ? 'PAUSED: new capital actions are stopped. Claims, withdrawals, and closes remain available.' : 'ACTIVE: independently priced limits are enforced on every new capital action.'}
      </p>
      <p className="lpw-sub">
        {vault ? `RESTRICTED VAULT: funds sit in Safe ${vault.safe}; treasury recovery is ${vault.treasury}. The session key is not a Safe owner.` : 'EOA MODE: application policies restrict signing, but possession of the session key itself remains a critical risk. Register a restricted Safe vault for on-chain enforcement.'}
      </p>
      <form className="lpw-capital-form" onSubmit={(event) => { event.preventDefault(); onSave({ maxActionUsd: Number(action), dailyNotionalUsd: Number(daily) }); }}>
        <label className="lpw-k" htmlFor="lp-capital-action">Per-action limit in dollars
          <input className="lpw-in" id="lp-capital-action" type="number" min="0.01" max="1000000" step="0.01" required value={action} disabled={busy} onChange={(event) => setAction(event.target.value)} />
        </label>
        <label className="lpw-k" htmlFor="lp-capital-daily">Daily movement limit in dollars
          <input className="lpw-in" id="lp-capital-daily" type="number" min="0.01" max="1000000" step="0.01" required value={daily} disabled={busy} onChange={(event) => setDaily(event.target.value)} />
        </label>
        <button className="lpw-btn" type="submit" disabled={busy}>SAVE LIMITS</button>
      </form>
      <p className="lpw-sub">Current: {money(capital.maxActionUsd)} per action · {money(capital.dailyNotionalUsd)} daily. Raising either default requires private broadcast.</p>
      <div className="lpw-acts">
        <button type="button" className="lpw-btn" aria-pressed={capital.privateBroadcastRequired} disabled={busy} onClick={() => onSave({ privateBroadcastRequired: !capital.privateBroadcastRequired })}>
          {capital.privateBroadcastRequired ? 'ALLOW PUBLIC BROADCAST' : 'REQUIRE PRIVATE BROADCAST'}
        </button>
        <button type="button" className="lpw-btn" aria-pressed={capital.paused} disabled={busy} onClick={() => { uiSound('activate'); onSave({ paused: !capital.paused }); }}>
          {capital.paused ? 'RESUME CAPITAL ACTIONS' : 'PAUSE NEW CAPITAL'}
        </button>
      </div>
    </section>
  );
};
