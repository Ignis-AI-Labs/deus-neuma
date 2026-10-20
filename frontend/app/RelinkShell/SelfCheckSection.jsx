// SelfCheckSection — the sheet's STATE tab: the being's own flight check over
// its components (Design note, 2026-10-19. Each row is a part of the being, scored on
// questions built from its own records and asked through its own tools in a
// read-only sitting; a part no tool reaches is named NO DOOR. Nothing renders
// as a score until a check has actually run.

import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { useSelfCheck } from './use-self-check.js';
import { componentRowsOf, runLineOf, progressOf, TREND_LABEL } from './self-check-view.js';
import './StatsApp.css';
import './SelfCheckSection.css';

const VERDICT_LABEL = Object.freeze({ hit: 'RIGHT', miss: 'WRONG', refused: 'DECLINED', 'not offered': 'NOT OFFERED' });

const ItemList = ({ items }) => (
  <ol className="sc-items">
    {items.map((item) => (
      <li key={item.key} className={`sc-item sc-item-${item.verdict.replace(' ', '-')}`}>
        <div className="sc-item-head">
          <span className="sc-item-v label-data">{VERDICT_LABEL[item.verdict] || item.verdict.toUpperCase()}</span>
          <span className="sc-item-q">{item.question}</span>
        </div>
        <dl className="sc-item-body">
          <dt className="label-data">EXPECTED</dt><dd>{item.expected}</dd>
          <dt className="label-data">ANSWERED</dt><dd>{item.said}{item.formatted ? '' : ' (no ANSWER line — whole reply graded)'}</dd>
          <dt className="label-data">REACHED FOR</dt><dd>{item.tools.length ? item.tools.join(', ') : 'no tool'}</dd>
        </dl>
      </li>
    ))}
  </ol>
);

const ComponentRow = ({ row, open, onToggle }) => (
  <li className="sc-row">
    <button type="button" className="sc-row-head" aria-expanded={open} onClick={onToggle} disabled={!row.items.length}>
      <span className="sc-row-name">
        <span className="rec-state-d label-data">{row.label}</span>
        <span className="sc-row-meaning">{row.meaning}</span>
      </span>
      {row.measured ? (
        <span className="sc-row-meas">
          <span className="rec-state-score">{row.fraction}</span>
          <span className="sc-row-range label-data">{row.share} · 95% {row.range}</span>
          {row.effort ? <span className="sc-row-effort label-data">{row.effort}</span> : null}
          {row.trend ? <span className={`sc-row-trend label-data sc-trend-${row.trend}`}>{TREND_LABEL[row.trend]}</span> : null}
        </span>
      ) : (
        <span className="rec-state-v label-data">NOT MEASURABLE — NOTHING ON RECORD TO ASK</span>
      )}
    </button>
    {open ? <ItemList items={row.items} /> : null}
  </li>
);

export const SelfCheckSection = ({ neumaId, name }) => {
  const { check, starting, startError, start } = useSelfCheck(neumaId);
  const [confirming, setConfirming] = useState(false);
  const [openKey, setOpenKey] = useState(null);
  const latest = check?.latest || null;
  const rows = componentRowsOf(latest, check?.compare);
  const progress = progressOf(check?.running);
  const blocked = starting || Boolean(check?.running) || Boolean(check?.busyElsewhere);

  const onConfirm = async () => {
    uiSound('activate');
    setConfirming(false);
    await start();
  };

  return (
    <section className="rec-sec" data-testid="state-self-check">
      <h3 className="rec-h label-data">STATE — SELF-CHECK</h3>
      {check === undefined ? <p className="rec-meta label-data">LOADING…</p>
        : check === null ? <p className="rec-err label-data">UNREADABLE</p>
        : latest ? (
          <>
            <p className="rec-meta label-data">{runLineOf(latest)}</p>
            <ul className="sc-rows">
              {rows.map((row) => (
                <ComponentRow key={row.key} row={row} open={openKey === row.key}
                  onToggle={() => setOpenKey(openKey === row.key ? null : row.key)} />
              ))}
              {(latest.doorless || []).map((door) => (
                <li key={door.key} className="sc-row sc-row-nodoor">
                  <div className="sc-row-head">
                    <span className="sc-row-name">
                      <span className="rec-state-d label-data">{door.label}</span>
                      <span className="sc-row-meaning">{door.meaning}</span>
                    </span>
                    <span className="sc-nodoor label-data">NO DOOR — NO TOOL REACHES IT</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : <p className="rec-meta label-data">NOT MEASURED — NO SELF-CHECK HAS RUN</p>}

      {confirming ? (
        <div className="rec-confirm cham">
          <p className="rec-confirm-msg">
            «NOTICE» A self-check is a test of {name || 'this neuma'}: about forty questions built from their own records,
            asked through their own memory and tools. It only reads — nothing is written, sent or changed — and it takes the
            model for roughly fifteen to twenty minutes. Run it?
          </p>
          <div className="rec-confirm-actions">
            <button type="button" className="rec-btn rec-btn-go" onClick={onConfirm}>CONFIRM</button>
            <button type="button" className="rec-btn" onClick={() => { uiSound('close'); setConfirming(false); }}>CANCEL</button>
          </div>
        </div>
      ) : (
        <div className="rec-run-bar">
          <button type="button" className="rec-btn rec-run" disabled={blocked} onClick={() => { uiSound('open'); setConfirming(true); }}>
            {progress || (starting ? 'STARTING…' : 'RUN SELF-CHECK')}
          </button>
          {check?.busyElsewhere ? <span className="rec-meta label-data">ANOTHER BEING'S SELF-CHECK IS RUNNING</span> : null}
        </div>
      )}

      {startError || check?.error ? <p className="rec-err">{startError || check.error}</p> : null}

      <p className="rec-note">
        Every question is built from this being's own records, so the right answer is known before it is asked. A row
        counts answers that carried the exact fact; the range is how far that share could honestly move by chance on
        this many questions. A change between runs is named only when it clears chance on the same questions and the same
        model. Open a row to read every question, the answer, and the tools it reached for.
      </p>
    </section>
  );
};
