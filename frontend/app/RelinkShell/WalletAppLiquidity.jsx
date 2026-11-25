// WalletAppLiquidity — what a house member's LIQUIDITY wallet adds under the
// ordinary wallet screen (Design note, 2026-11-13: […]). The balance, address, Receive and
// tokens are the same screen every wallet has; this panel adds only what is
// Umbrae's: the budget as a bar, each waiting deposit with its yes and no, and
// each position as its range with the pool's price on it. The rules fold away.
// A problem is a door: the connection being off opens Settings at its switch.
// Backend: backend/routes/lp-wallet-routes.js. Figures: lp-figures.js.

import { useState } from 'react';
import { setLpBudget, setLpCapital, answerLpDeposit, setLpPace, answerLpReward } from './lp-wallet-client.js';
import { WalletCapitalControls } from './WalletCapitalControls.jsx';
import { positionRows, poolNamed, lpTotals, nameCase } from './lp-figures.js';
import { BudgetMeter, WaitingCard, PositionCard } from './WalletLiquidityCards.jsx';
import { EarningsCard, ClockCard, GoalsCard } from './WalletEarnings.jsx';
import { useWindows } from '../windowing/use-windows.js';
import { requestSettingsFocus } from './settings-focus.js';
import { uiSound } from '../../services/ui-sound.js';
import './WalletLiquidity.css';

// The switch is the operator's: the door opens Settings at that very row.
const ConnectionDoor = () => {
  const windows = useWindows();
  const go = () => {
    uiSound('open');
    windows?.dispatch({ type: 'OPEN', id: 'settings' });
    requestSettingsFocus('connections/umbrae-liquidity');
  };
  return (
    <div className="lpw-door" role="status">
      <span className="lpw-door-dot" aria-hidden="true" />
      <span className="lpw-door-text">Umbrae connection is off</span>
      <button type="button" className="lpw-btn is-primary" onClick={go}>TURN ON →</button>
    </div>
  );
};

const Rules = () => (
  <details className="lpw-rules">
    <summary>What this wallet can do</summary>
    <ul>
      <li>Opens, adds, claims, withdraws and closes Umbrae positions on its own.</li>
      <li>Swaps only through Umbrae&apos;s router, between tokens Umbrae&apos;s pools trade.</li>
      <li>Sends only to wallets of your house, to you, or to addresses on your list.</li>
      <li>Everything it takes out or buys comes back to this address.</li>
      <li>With a budget cap set, a deposit past it waits for you here.</li>
      <li>Its key stays on this computer. Funding always comes from you.</li>
      <li>Earned = what it holds now, plus what it sent to the house and spent on rewards, minus what it was given. Rewards draw only on that.</li>
    </ul>
  </details>
);

/** Before the wallet exists: one line, one press. */
export const LiquidityOpen = ({ name, onOpen, error }) => (
  <section className="lpw-card lpw-open">
    <p className="lpw-step">A second wallet for {nameCase(name)}, used only to provide liquidity on Umbrae.</p>
    <button type="button" className="lpw-btn is-primary" onClick={() => { uiSound('activate'); onOpen(); }}>OPEN LP WALLET</button>
    {error ? <p className="wal-err label-data">{error}</p> : null}
    <Rules />
  </section>
);

/**
 * @param {{neumaId: string, name: string, state: ReturnType<typeof import('./use-lp-wallet.js').useLpWallet>}} props
 */
export const LiquidityPanel = ({ neumaId, name, state }) => {
  const { lp, error, reload } = state;
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  if (!lp) return null;

  const rows = positionRows(lp.positions);
  const { inPositions, waiting: waitingUsd } = lpTotals(lp);

  const answer = async (id, verdict) => {
    uiSound('activate');
    setBusy(id); setResult(verdict === 'approve' ? { ok: true, text: 'Running on Base…' } : null);
    const r = await answerLpDeposit(neumaId, id, verdict);
    setBusy(null);
    if (!r.ok) setResult({ ok: false, text: r.reason || r.error });
    else setResult({ ok: true, text: r.declined ? 'Declined. Nothing moved.' : `Done: ${r.txHashes.length} transaction(s) on Base${r.tokenId ? `, position #${r.tokenId}` : ''}.` });
    await reload();
  };
  const savePace = async (minutes) => {
    const r = await setLpPace(neumaId, minutes);
    if (!r.ok) return r.error;
    await reload();
    return null;
  };
  const answerReward = async (id, verdict, note) => {
    setBusy(id); setResult(verdict === 'approve' ? { ok: true, text: 'Paying on Base…' } : null);
    const r = await answerLpReward(neumaId, id, verdict, note);
    setBusy(null);
    if (!r.ok) setResult({ ok: false, text: r.reason || r.error });
    else setResult({ ok: true, text: { approve: `Paid: ${r.goal?.what}. Get it for ${nameCase(name)}, then mark it delivered.`, decline: 'Declined. It keeps the goal and hears why.', delivered: 'Marked delivered. It stays on its record.' }[verdict] });
    await reload();
  };
  const saveBudget = async (n) => {
    const r = await setLpBudget(neumaId, n);
    if (!r.ok) return r.error;
    await reload();
    return null;
  };
  const saveCapital = async (patch) => {
    setBusy('capital');
    const r = await setLpCapital(neumaId, patch);
    setBusy(null);
    setResult(r.ok ? { ok: true, text: 'Capital controls updated.' } : { ok: false, text: r.reason || r.error });
    await reload();
  };

  return (
    <div className="lpw" aria-label="Liquidity on Umbrae" role="region">
      {lp.connectionOn ? null : <ConnectionDoor />}
      {result ? <p className={result.ok ? 'wal-ok label-data' : 'wal-err label-data'} role="status">{result.text}</p> : null}

      <EarningsCard book={lp.book} />
      <ClockCard clock={lp.clock} name={name} onPace={savePace} />

      <BudgetMeter budgetUsd={lp.budgetUsd} inPositionsUsd={inPositions} waitingUsd={waitingUsd} onSave={saveBudget} />
      {lp.capital ? <WalletCapitalControls capital={lp.capital} vault={lp.vault} busy={busy === 'capital'} onSave={saveCapital} /> : null}

      {lp.pending.length ? (
        <section aria-label="Waiting for you">
          <h3 className="lpw-h">WAITING FOR YOU <span className="lpw-count">{lp.pending.length}</span></h3>
          <ul className="lpw-list">
            {lp.pending.map((r) => <WaitingCard key={r.id} request={r} pools={lp.pools} budgetUsd={lp.budgetUsd} busy={busy !== null} onAnswer={(v) => answer(r.id, v)} />)}
          </ul>
        </section>
      ) : null}

      <section aria-label="Positions">
        <h3 className="lpw-h">POSITIONS <span className="lpw-count">{rows.length}</span></h3>
        {lp.positionsNote ? <p className="lpw-sub">{lp.positionsNote}</p> : null}
        {rows.length ? (
          <ul className="lpw-list">
            {rows.map((row) => <PositionCard key={`${row.pool}-${row.id}`} row={row} symbols={poolNamed(lp.pools, row.pool)} />)}
          </ul>
        ) : (!lp.positionsNote ? <p className="lpw-sub">None yet. {nameCase(name)} opens them from its own seat.</p> : null)}
      </section>

      <GoalsCard goals={lp.goals} freeUsd={lp.book?.freeUsd} name={name} busy={busy !== null} onAnswer={answerReward} />

      {error ? <p className="wal-err label-data">{error}</p> : null}
      <Rules />
    </div>
  );
};
