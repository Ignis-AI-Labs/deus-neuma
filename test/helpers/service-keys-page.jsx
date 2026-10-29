// impure - browser fixture: the PRODUCTION Settings → API service keys section,
// with the desk's own i18n, against the real routing router — handed the board
// exactly as the API tab hands it (SettingsApiTab.jsx reads it once).
/* global window, sessionStorage, document */
import '../../frontend/i18n/index.js';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { listServices } from '../../frontend/services/routing.js';
import { ServiceKeysSection } from '../../frontend/app/RelinkShell/ServiceKeysSection.jsx';

const Page = () => {
  const [services, setServices] = useState(null);
  const [error, setError] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const refresh = useCallback(() => listServices().then((r) => setServices(r.services)).catch((e) => setError(e.message)), []);
  useEffect(() => { refresh(); }, [refresh]);
  return <ServiceKeysSection services={services} error={error} onChanged={refresh} stateFilter="" openKey={openKey} onOpen={setOpenKey} />;
};

sessionStorage.setItem('authToken', window.serviceKeysFixture.token);
createRoot(document.getElementById('root')).render(<Page />);
