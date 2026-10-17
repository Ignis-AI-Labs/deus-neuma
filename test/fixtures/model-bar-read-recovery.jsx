import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelBar } from '../../frontend/app/RelinkShell/ModelBar.jsx';
import '../../frontend/styles/tokens.css';
import '../../frontend/app/RelinkShell/RelinkShell-composer.css';

function Fixture() {
  const [beingId, setBeingId] = useState('model-bar-proof');
  return <>
    <button onClick={() => setBeingId('missing-owner')}>Other chat</button>
    <button onClick={() => setBeingId('model-bar-proof')}>Original chat</button>
    <ModelBar beingId={beingId} />
  </>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
