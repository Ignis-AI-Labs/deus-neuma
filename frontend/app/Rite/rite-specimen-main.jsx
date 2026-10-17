// rite-specimen-main — entry for the dev-only SUMMONING RITE specimen page
// (frontend/rite.html, never in the build input). Wears the operator's LOOK
// exactly as the desk does.
import '../../styles/main.css';
import { createRoot } from 'react-dom/client';
import { bootLook } from '../../services/look.js';
import { RitePlayer } from './RitePlayer.jsx';

bootLook();
createRoot(document.getElementById('root')).render(<RitePlayer />);
