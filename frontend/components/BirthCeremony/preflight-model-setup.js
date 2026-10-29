// preflight-model-setup — the birth's flight check offers the same model setup as the door.
//
// A summoning whose machine serves no model used to stop at […]: a dead end for anyone who has never run one. The flight
// check now carries the door's own setup card (FirstRunChoice/ModelServerSetup.jsx: the plan read
// from this machine, the download, its progress, STOP), so there is one setup, never two copies.
// The ceremony stays vanilla; this mounts the React card into one of its elements.
//
// impure (DOM, React root).

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelServerSetup } from '../../app/FirstRunChoice/ModelServerSetup.jsx';

/**
 * Mount the setup card into a host element; `onDone` runs when the model is ready. impure.
 * @param {HTMLElement} host
 * @param {() => void} onDone - the flight check runs again
 * @returns {() => void} unmount
 */
export const mountModelSetup = (host, onDone) => {
  const root = createRoot(host);
  root.render(createElement(ModelServerSetup, { onDone }));
  return () => root.unmount();
};
