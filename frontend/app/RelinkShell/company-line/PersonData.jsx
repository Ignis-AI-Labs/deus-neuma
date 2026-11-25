// PersonData — under a person's row in LEADS: everything the house holds on them as one file (to hand them when they
// ask), and ERASE (when they ask to be forgotten). Erasing asks for their address again, says what it removed and
// what it kept: their do-not-contact entry, so they are never written to again (backend/services/sales/person-data.js).
// impure — network, a file download.

import { useState } from 'react';
import { getPersonRecord, erasePerson } from '../../../services/person-data-client.js';

const download = (name, value) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const erasedWords = (e) => [`ERASED ${e.address}: ${e.leads} lead${e.leads === 1 ? '' : 's'} removed`, ...e.dropped.map((d) => `${d.records} record${d.records === 1 ? '' : 's'} from ${d.file}`),
  'kept on the do-not-contact list only, so they are never written to again', ...e.left.map((l) => `STILL NAMES THEM: ${l}`)].join(' · ');

/** @param {{address: string, busy: boolean, onErased: Function}} props */
export const PersonData = ({ address, busy, onErased }) => {
  const [confirm, setConfirm] = useState('');
  const [said, setSaid] = useState(null);
  const [working, setWorking] = useState(false);
  const run = async (fn) => {
    setWorking(true);
    try { setSaid(await fn()); } catch (e) { setSaid(e.message); } finally { setWorking(false); }
  };
  const off = busy || working;
  return (
    <div className="cline-open" data-person-data={address}>
      <button type="button" className="sec-scan cline-mini label-data" disabled={off} aria-label={`EXPORT THEIR DATA — everything the house holds on ${address}`}
        onClick={() => run(async () => { const record = await getPersonRecord(address); download(`data-held-on-${address}.json`, record); return `EXPORTED: ${record.held.length} place${record.held.length === 1 ? '' : 's'} hold ${address}`; })}>EXPORT THEIR DATA</button>
      <input className="cline-input" aria-label={`Type ${address} to erase them`} placeholder={`type ${address} to erase them`} disabled={off} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <button type="button" className="sec-scan cline-danger cline-mini label-data" disabled={off || confirm.trim().toLowerCase() !== address.toLowerCase()} aria-label={`ERASE ${address} — cannot be undone`}
        onClick={() => run(async () => { const e = await erasePerson(address, confirm); await onErased?.(); return erasedWords(e); })}>ERASE</button>
      {said ? <span className="cline-move-t" role="status" data-person-said="">{said}</span> : null}
    </div>
  );
};
