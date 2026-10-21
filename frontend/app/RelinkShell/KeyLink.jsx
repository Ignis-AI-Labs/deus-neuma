// KeyLink — "get a key" beside a credential input: the page where this key,
// token or address is made, opened in the system browser (target=_blank goes
// to the OS, desk-links.cjs). Nothing renders until the map is read, and
// nothing renders for a credential the map does not know.
import { useEffect, useState } from 'react';
import { loadCredentialLinks, linksFor } from '../../services/credential-links.js';
import './KeyLink.css';

export const KeyLink = ({ provider = null, family = null, id = null, lead = 'GET A KEY' }) => {
  const [map, setMap] = useState(null);
  useEffect(() => {
    let live = true;
    loadCredentialLinks().then((m) => { if (live) setMap(m); });
    return () => { live = false; };
  }, []);
  const links = linksFor(map, { provider, family, id });
  if (!links.length) return null;
  return (
    <div className="settings-key-links">
      {links.map((l) => (
        <span key={l.url} className="settings-key-link">
          <a className="label-data" href={l.url} target="_blank" rel="noreferrer">{`${lead} · ${l.label} ↗`}</a>
          {l.note ? <span className="settings-key-note">{l.note}</span> : null}
        </span>
      ))}
    </div>
  );
};
