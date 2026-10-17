// Real terminal app, window chrome, manager, xterm and transport; no portal/being.
// The small fixture phase host exposes disposal without booting AppShell's GPU field.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WindowManager } from '../../frontend/app/windowing/WindowManager.jsx';
import { WindowLayer } from '../../frontend/app/windowing/WindowLayer.jsx';
import { terminalApp } from '../../frontend/app/RelinkShell/terminal/TerminalApp.jsx';
import { apiCall } from '../../frontend/utils/http.js';
import '../../frontend/styles/tokens.css';
// The desk's language, as main.jsx boots it — the window's controls are translated.
import '../../frontend/i18n/index.js';

const registry = Object.freeze({ terminal: terminalApp });
const Fixture = () => {
  const [mounted, setMounted] = useState(true);
  const [status, setStatus] = useState('desk');
  useEffect(() => {
    const expired = () => { setMounted(false); setStatus('reauth required'); };
    window.addEventListener('neuma:auth_expired', expired);
    return () => window.removeEventListener('neuma:auth_expired', expired);
  }, []);
  const rejectedRest = async () => {
    try {
      await apiCall('GET', '/api/v1/auth/session', { headers: { Authorization: 'Bearer invalid-fixture-token' } });
      setStatus('unexpected authorization');
    } catch (err) { setStatus(`REST ${err.http}; reauth required`); }
  };
  return <>
    <nav style={{ position: 'fixed', top: 0, left: 0, zIndex: 1000 }}>
      <button onClick={rejectedRest}>Rejected REST</button>
      <button onClick={() => setMounted(false)}>Detach view</button>
      <button onClick={() => { setMounted(true); setStatus('desk'); }}>Resume view</button>
      <output>{status}</output>
    </nav>
    {mounted && <WindowManager registry={registry} defaultOpen={['terminal']}><WindowLayer /></WindowManager>}
  </>;
};
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>);
