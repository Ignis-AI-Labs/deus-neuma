// impure - browser fixture: the PRODUCTION lead engine section of the COMPANY
// LINE window, with the desk's styles and the window's own, against the real
// /api/v1/revenue routes.
/* global window, sessionStorage, document */
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/company-line/CompanyLine.css';
import { createRoot } from 'react-dom/client';
import { LeadEngineSection } from '../../frontend/app/RelinkShell/company-line/LeadEngineSection.jsx';

sessionStorage.setItem('authToken', window.leadEngineFixture.token);
createRoot(document.getElementById('root')).render(
  <div className="cline-root" style={{ padding: 16 }}><LeadEngineSection /></div>,
);
