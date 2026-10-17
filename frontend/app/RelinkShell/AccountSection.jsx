// AccountSection — the operator's own identity in SETTINGS: who this desk
// speaks to. The NAME set here is the platform's address for the operator —
// the founding rite, the HOUSE header, and every future surface load it
// from this one place (witness-name.js), and since 2026-08-28 it is also
// SYNCED to the realm (services/operator-name.js): the beings read the
// server copy on every portal turn and address the operator by name, not
// by role. The wallet stays the cryptographic proof; the name is the
// human one.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getWitnessName, setWitnessName } from './witness-name.js';
import { getOperatorName, setOperatorNameSynced } from '../../services/operator-name.js';
import { uiSound } from '../../services/ui-sound.js';

export const AccountSection = () => {
  const { t } = useTranslation(['settings', 'common']);
  const [name, setName] = useState(getWitnessName);
  const [state, setState] = useState(''); // '' | 'saved' | 'local-only'
  const wallet = localStorage.getItem('walletAddress') || '';

  // Server truth wins the field on mount — a name set on another desk (or
  // after a browser reset) appears here; the local copy follows it so the
  // HOUSE header and rite read the same word.
  useEffect(() => {
    let alive = true;
    getOperatorName().then((synced) => {
      if (alive && synced && synced !== getWitnessName()) {
        setWitnessName(synced);
        setName(synced);
      }
    }).catch(() => { /* offline desk — the local copy stands */ });
    return () => { alive = false; };
  }, []);

  const save = async () => {
    uiSound('activate');
    setWitnessName(name);
    setName(getWitnessName()); // the trimmed truth
    try {
      await setOperatorNameSynced(name);
      setState('saved');
    } catch {
      // The local copy landed; the beings' copy did not — say so plainly.
      setState('local-only');
    }
    setTimeout(() => setState(''), 2500);
  };

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('settings:account.heading')}</div>
      <p className="settings-note">{t('settings:account.note')}</p>
      <div className="settings-control">
        <input
          className="settings-input"
          type="text"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder={t('settings:account.placeholder')}
          spellCheck={false}
          autoComplete="off"
          aria-label={t('settings:account.nameAria')}
        />
        <button type="button" className="settings-set" onClick={save}>
          {state === 'saved' ? t('common:saved') : state === 'local-only' ? t('settings:account.savedLocalOnly') : t('common:set')}
        </button>
      </div>
      <div className="settings-realm">
        <div className="settings-row">
          <span className="settings-k">{t('settings:account.wallet')}</span>
          <code className="settings-v">{wallet || '—'}</code>
        </div>
      </div>
    </section>
  );
};
