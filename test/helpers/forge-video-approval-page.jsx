// impure - browser fixture: the PRODUCTION ApprovalChip, fed the approval frame the real broker sent
// for a post carrying one of the being's own forge clips and stills (by id).
/* global window, sessionStorage */
import { createRoot } from 'react-dom/client';
import { ApprovalChip } from '../../frontend/app/RelinkShell/ApprovalChip.jsx';
import { streamCardAction } from '../../frontend/app/RelinkShell/stream-card-actions.js';
import { reducer, initialState } from '../../frontend/app/RelinkShell/stream-reducer.js';

const { token, laneId, card } = window.chipFixture;
sessionStorage.setItem('authToken', token);
const state = [
  { type: 'USER_SENT', text: 'post it' }, { type: 'SPEECH', text: 'Staging.' },
  streamCardAction(card.type, card, laneId).action,
].reduce(reducer, initialState);
const segment = state.messages.find((m) => m.streaming).segments.find((s) => s.kind === 'approval');
createRoot(document.getElementById('root')).render(<ApprovalChip segment={segment} onRespond={() => {}} />);
