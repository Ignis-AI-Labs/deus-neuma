// TierCorner — the small […] link top-right of the forge.
//
// Every tier clones the SAME voice; only quality and speed change (Founder,
// 2026-10-01). The link shows the tier in force; opening it lists auto and the
// three tiers with what each costs this machine, as a popover. A pick that reaches past
// what the machine recommends — or does not fit beside the mind — earns the
// plain warning and a second press before it is saved. impure (REST).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';
import { readTier, writeTier } from './forge-client.js';
import { tierCornerOf, tierNeedsWarning } from './forge-tier-model.js';
import { GearIcon } from './forge-icons.jsx';

// pure — a choice's cost line, or null when unmeasured.
const costLine = (t, cost) => {
  if (!cost || cost.gb === null) return null;
  return cost.device === 'gpu' ? t('tier.gpu', { gb: cost.gb }) : t('tier.cpu', { gb: cost.gb });
};

export const TierCorner = () => {
  const { t } = useTranslation('voiceForge');
  const [answer, setAnswer] = useState(undefined);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let current = true;
    readTier().then((a) => { if (current) setAnswer(a); }, () => { if (current) setAnswer(null); });
    return () => { current = false; };
  }, []);

  const view = tierCornerOf(answer);
  if (answer === undefined) return null;
  if (!view) return <div className="vf-tier label-data" data-tier="unreadable">{t('tier.unreadable')}</div>;

  const tierName = (id) => t(`tier.names.${id}`);
  const save = async (choice) => {
    setError(null);
    try {
      setAnswer(await writeTier(choice.id));
      setPending(null);
      setOpen(false);
      uiSound('activate');
    } catch (err) {
      setError(err?.message || String(err));
    }
  };
  const choose = (choice) => {
    uiSound('toggle');
    if (tierNeedsWarning(choice)) setPending(choice);
    else save(choice);
  };

  return (
    <div className="vf-tier" data-tier={view.tier} data-setting={view.setting}>
      <button
        type="button"
        className="vf-tier-change"
        aria-expanded={open}
        title={t('tier.title')}
        onClick={() => { setOpen(!open); setPending(null); }}
      >
        <GearIcon />
        <span className="vf-tier-label">{t('tier.corner', { tier: tierName(view.tier), engine: view.engineName })}</span>
      </button>
      {open ? (
        <div className="vf-tier-menu cham"><div className="cham-in vf-tier-menu-in">
          <p className="label-data vf-tier-head">{t('tier.title')}</p>
          <ul className="vf-tier-list">
            {view.choices.map((c) => (
              <li key={c.id}>
                <button type="button" className="vf-tier-choice" data-choice={c.id} aria-pressed={view.setting === c.id} onClick={() => choose(c)}>
                  <span className="label-data">{c.id === 'auto' ? t('tier.auto') : `${tierName(c.id)} · ${c.engineName}`}</span>
                  <span className="vf-tier-cost">
                    {c.id === 'auto' && view.autoTier ? t('tier.autoNote', { tier: tierName(view.autoTier) }) : costLine(t, c.cost)}
                    {c.id === view.autoTier ? ` · ${t('tier.recommended')}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {pending ? (
            <div className="vf-tier-warn">
              <p className="vf-note vf-note-alert">{t('tier.warning')}</p>
              <div className="vf-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setPending(null)}>{t('tier.cancel')}</button>
                <button type="button" className="btn btn-primary vf-tier-confirm" onClick={() => save(pending)}>{t('tier.confirm')}</button>
              </div>
            </div>
          ) : null}
          {view.reason ? <p className="vf-note vf-tier-reason">{view.reason}</p> : null}
          {error ? <p className="vf-note vf-note-alert">{error}</p> : null}
        </div></div>
      ) : null}
    </div>
  );
};
