// RemoteAccessLog — every time this desk was reached from outside it, as one sheet (backend/services/remote/
// access-log.js; docs/work/crm-match-blob.md, 2026-11-23). A paired phone signing in, a phone cut, a road opened or
// closed, a request the gate refused: one line each, newest first, the older ones a press away. The install owner's
// to read; anyone else sees nothing here. impure — network.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../utils/format.js';
import { getAccessLog } from '../../services/remote-client.js';
import { Sheet } from './sheet/Sheet.jsx';

const whoOf = (e) => [e.label, e.device, e.peer].filter(Boolean).join(' · ') || null;
const whyOf = (e) => [e.road, e.reason, e.method && e.path ? `${e.method} ${e.path}` : null].filter(Boolean).join(' · ') || null;

export const RemoteAccessLog = () => {
  const { t } = useTranslation('settingsSecurity');
  const [log, setLog] = useState(null);
  const load = useCallback(() => getAccessLog().then(setLog, () => setLog(null)), []);
  useEffect(() => { load(); }, [load]);
  if (!log) return null;
  const older = () => getAccessLog({ before: log.entries.at(-1)?.at }).then((next) => setLog({ entries: [...log.entries, ...next.entries], more: next.more }), () => {});
  const columns = [
    { head: t('remote.logWhen'), cell: (e) => formatDateTime(e.at) },
    { head: t('remote.logWhat'), cell: (e) => t(`remote.logEvents.${e.event}`, { defaultValue: String(e.event).toUpperCase() }), tone: (e) => (e.event === 'refused' ? 'alert' : null) },
    { head: t('remote.logWho'), cell: whoOf, exact: true },
    { head: t('remote.logWhy'), cell: (e) => [whyOf(e), e.repeats ? t('remote.logRepeats', { count: e.repeats }) : null].filter(Boolean).join(' · ') || null },
  ];
  return (
    <div className="remote-devices" data-access-log="">
      <h4 className="label-data remote-devices-h">{t('remote.logHeading')}</h4>
      <p className="settings-note">{t('remote.logNote')}</p>
      <Sheet label="access log" columns={columns} rows={log.entries} rowKey={(e) => `${e.at}|${e.event}|${e.device ?? e.peer ?? ''}`} rowName={(e) => `${e.event} ${e.at}`}
        empty={<p className="settings-note">{t('remote.logNone')}</p>} />
      {log.more ? <button type="button" className="settings-set" onClick={older}>{t('remote.logMore')}</button> : null}
    </div>
  );
};
