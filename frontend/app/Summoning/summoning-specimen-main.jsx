// summoning-specimen-main — entry for the dev-only SUMMONING specimen page
// (frontend/summoning.html, never in the build input). Wears the operator's
// LOOK exactly as the desk does.
import '../../styles/main.css';
import { createRoot } from 'react-dom/client';
import { bootLook } from '../../services/look.js';
import { SummoningSpecimen } from './SummoningSpecimen.jsx';

bootLook();
createRoot(document.getElementById('root')).render(<SummoningSpecimen />);
