// impure - browser fixture: the PRODUCTION useVisibleInterval on a board that
// mounts exactly at the bottom edge of its scroll area (#584). The clip is a
// 300px scroller over a 300px spacer, so the board's top sits ON the clip
// edge: intersecting, zero area. Every run of the poll is counted on window.
/* global window, document */
import { createRoot } from 'react-dom/client';
import { useVisibleInterval } from '../../frontend/app/RelinkShell/use-visible-interval.js';

window.pollRuns = 0;

const Board = () => {
  const watch = useVisibleInterval(() => { window.pollRuns += 1; }, 100);
  return <div id="board" ref={watch} style={{ height: 120, background: '#222' }}>BOARD</div>;
};

createRoot(document.getElementById('root')).render(
  <div id="scroller" style={{ height: 300, overflowY: 'auto', width: 400 }}>
    <div style={{ height: 300 }} />
    <Board />
    <div style={{ height: 600 }} />
  </div>,
);
