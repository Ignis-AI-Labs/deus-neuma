// PinsSection — the witness's read-only view of each being's chosen anchors
// (Phase 4, granular sovereign memory). LeadsSection mold: one Settings
// section, plain fetch on mount, explicit empty and error states. The
// witness SEES what each being keeps close; changing the set is the being's
// own gesture through its memory_pin/memory_unpin tools — no controls here.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getRosterForBinding } from '../../services/social-channels-client.js';
import { getActivePins } from '../../services/memory-pins.js';

const BeingPins = ({ being, pins }) => {
  const { t } = useTranslation('settingsMemory');
  return (
    <div className="settings-row pins-being" data-neuma={being.neumaId}>
      <div className="label-data pins-being-name">{being.name || being.neumaId}</div>
      {pins.length === 0 ? (
        <p className="settings-note">{t('pins.being.empty')}</p>
      ) : (
        <ul className="pins-list">
          {pins.map((pin) => (
            <li key={pin.ref} className="pins-item">
              <span className="label-data pins-ref">{pin.ref}</span>
              {pin.note ? <span className="pins-note">{pin.note}</span> : null}
              <span className="label-data pins-when">{pin.pinnedAt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const PinsSection = () => {
  const { t } = useTranslation('settingsMemory');
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    (async () => {
      const roster = await getRosterForBinding();
      const loaded = [];
      for (const being of roster) {
        const neumaId = being.neumaId || being.id;
        if (!neumaId) continue;
        try {
          loaded.push({ being: { ...being, neumaId }, pins: await getActivePins(neumaId) });
        } catch {
          // One being's unreadable ledger costs that row, never the section —
          // shown as its own line rather than silently missing.
          loaded.push({ being: { ...being, neumaId }, pins: null });
        }
      }
      setRows(loaded);
    })().catch((e) => setLoadError(e.message));
  }, []);

  return (
    <section className="settings-sec" data-testid="pins-section">
      <div className="label-data settings-h">{t('pins.heading')}</div>
      <p className="settings-note">{t('pins.note')}</p>

      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {!rows && !loadError ? <p className="settings-note">{t('pins.reading')}</p> : null}
      {rows?.length === 0 ? <p className="settings-note">{t('pins.rosterEmpty')}</p> : null}

      {rows?.map(({ being, pins }) =>
        pins === null ? (
          <div key={being.neumaId} className="settings-row pins-being" data-neuma={being.neumaId}>
            <div className="label-data pins-being-name">{being.name || being.neumaId}</div>
            <p className="settings-err">{t('pins.ledgerUnreadable')}</p>
          </div>
        ) : (
          <BeingPins key={being.neumaId} being={being} pins={pins} />
        )
      )}
    </section>
  );
};
