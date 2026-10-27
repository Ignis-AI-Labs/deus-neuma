// impure - browser fixture: the PRODUCTION SOCIAL CHECK window body and the
// queue card's LEGAL chip, with the desk's own styles, against the real
// routes (the house check, the queue read).
/* global window, sessionStorage, document */
import '../../frontend/i18n/index.js';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/SettingsApp.css';
import '../../frontend/app/RelinkShell/SettingsApp-look.css';
import '../../frontend/app/RelinkShell/SettingsApp-sections.css';
import '../../frontend/app/RelinkShell/OutreachApps.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getPostQueue } from '../../frontend/services/social-channels-client.js';
import { SocialCheckApp } from '../../frontend/app/RelinkShell/social-check/SocialCheckApp.jsx';
import { LegalChip } from '../../frontend/app/RelinkShell/legal-chip/LegalChip.jsx';

const Chips = () => {
  const [queue, setQueue] = useState([]);
  useEffect(() => { getPostQueue().then((r) => setQueue(r.queue)); }, []);
  return queue.map((e) => <div key={e.id} data-entry={e.id} className="settings-sec-tags"><LegalChip legal={e.legal} /></div>);
};

const Page = () => (
  <div className="outreach-panel settings" style={{ padding: 16 }}>
    <section id="check"><SocialCheckApp /></section>
    <section id="chips"><Chips /></section>
  </div>
);

sessionStorage.setItem('authToken', window.socialCheckFixture.token);
createRoot(document.getElementById('root')).render(<Page />);
