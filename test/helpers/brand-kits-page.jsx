// impure - browser fixture: the PRODUCTION brand kit editor (BrandKitsShell), opened on one kit,
// with the desk's styles and the panel's own, against the real /api/v1 routes.
/* global window, sessionStorage, document */
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/brandkits/BrandKits.css';
import { createRoot } from 'react-dom/client';
import { BrandKitsShell } from '../../frontend/app/RelinkShell/brandkits/BrandKitsShell.jsx';

sessionStorage.setItem('authToken', window.brandKitsFixture.token);
createRoot(document.getElementById('root')).render(
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><BrandKitsShell brand={window.brandKitsFixture.brand} /></div>,
);
