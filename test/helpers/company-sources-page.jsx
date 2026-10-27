// impure - browser fixture: the PRODUCTION SITE & CODE panel of a brand kit
// (CompanySources, as the kit editor mounts it), with the desk's styles and
// the brand kits' own, against the real /api/v1/companies routes.
/* global window, sessionStorage, document */
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/brandkits/BrandKits.css';
import '../../frontend/app/RelinkShell/brandkits/BrandKits-fields.css';
import { createRoot } from 'react-dom/client';
import { CompanySources } from '../../frontend/app/RelinkShell/brandkits/CompanySources.jsx';

const { token, companyId, roster } = window.sourcesFixture;
sessionStorage.setItem('authToken', token);
createRoot(document.getElementById('root')).render(
  <div className="bk" style={{ padding: 16 }}><main className="bk-editor"><CompanySources companyId={companyId} roster={roster} /></main></div>,
);
