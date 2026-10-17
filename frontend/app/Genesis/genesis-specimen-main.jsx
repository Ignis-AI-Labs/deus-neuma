// genesis-specimen-main — entry for the dev-only GENESIS specimen page
// (frontend/genesis.html, never in the build input). Wears the operator's
// LOOK exactly as the desk does, so the rehearsal shows the real palette.
import '../../styles/main.css';
import { createRoot } from 'react-dom/client';
import { bootLook } from '../../services/look.js';
import { GenesisSpecimen } from './GenesisSpecimen.jsx';

bootLook();
createRoot(document.getElementById('root')).render(<GenesisSpecimen />);
