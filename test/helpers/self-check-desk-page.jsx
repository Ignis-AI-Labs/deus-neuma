// impure — the sheet's STATE tab (the real SelfCheckSection) over real authenticated routes.
import { createRoot } from 'react-dom/client';
import { StateSection } from '../../frontend/app/RelinkShell/RecordStatus.jsx';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/RelinkShell.css';

const lane = new URLSearchParams(window.location.search).get('lane');
createRoot(document.getElementById('root')).render(
  <div style={{ width: 920, padding: 24 }}><StateSection neumaId={lane} name="Ondine" /></div>,
);
