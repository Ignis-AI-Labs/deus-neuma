// dreams-specimen-main — entry for the dev-only DREAMS specimen page
// (frontend/dreams.html, never in the build input): the pane alone, in the
// pocket's frame, wearing the operator's LOOK as the desk does.
import '../../styles/main.css';
import './PocketShell.css';
import { createRoot } from 'react-dom/client';
import { bootLook } from '../../services/look.js';
import { PocketDreams } from './PocketDreams.jsx';

bootLook();
createRoot(document.getElementById('root')).render(
  <div className="pocket"><main className="pocket-pane"><PocketDreams /></main></div>,
);
