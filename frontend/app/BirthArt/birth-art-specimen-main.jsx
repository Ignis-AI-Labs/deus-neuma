// birth-art-specimen-main — entry for the dev-only BIRTH ART specimen page
// (frontend/birth-art.html, never in the build input). Wears the operator's
// LOOK exactly as the desk does.
import '../../styles/main.css';
import { createRoot } from 'react-dom/client';
import { bootLook } from '../../services/look.js';
import { BirthArtSpecimen } from './BirthArtSpecimen.jsx';

bootLook();
createRoot(document.getElementById('root')).render(<BirthArtSpecimen />);
