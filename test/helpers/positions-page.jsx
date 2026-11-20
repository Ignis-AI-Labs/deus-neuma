// impure - browser fixture: the PRODUCTION positions board with its PRODUCTION
// function panels, the desk's styles and the window's own, against the real
// /api/v1 routes. No desk context is given: the board stands without one.
/* global window, sessionStorage, document */
import '../../frontend/styles/main.css';
import { createRoot } from 'react-dom/client';
import { PositionsBoard } from '../../frontend/app/RelinkShell/positions/PositionsBoard.jsx';
import { PositionPanel } from '../../frontend/app/RelinkShell/positions/position-panels.jsx';

sessionStorage.setItem('authToken', window.positionsFixture.token);
createRoot(document.getElementById('root')).render(
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><PositionsBoard Panel={PositionPanel} /></div>,
);
