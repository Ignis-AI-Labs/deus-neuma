// impure - browser fixture: the PRODUCTION KeyLink, for a provider, a channel, a
// family with several choices, and a credential the map does not know.
/* global window, sessionStorage, document */
import { createRoot } from 'react-dom/client';
import { KeyLink } from '../../frontend/app/RelinkShell/KeyLink.jsx';

sessionStorage.setItem('authToken', window.keyLinkFixture.token);
createRoot(document.getElementById('root')).render(
  <div>
    <section id="provider"><KeyLink provider="anthropic" /></section>
    <section id="channel"><KeyLink family="channel" id="bluesky" lead="GET THE KEYS" /></section>
    <section id="rpc"><KeyLink family="chain" id="rpc" lead="GET AN RPC URL" /></section>
    <section id="unknown"><KeyLink family="channel" id="myspace" /></section>
  </div>,
);
