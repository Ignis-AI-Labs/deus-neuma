import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CouncilDissolve } from '../../frontend/app/RelinkShell/CouncilDissolve.jsx';
import { useCouncilStream } from '../../frontend/app/RelinkShell/use-council-stream.js';
import { WebSocketService } from '../../frontend/services/WebSocketService.js';
const service = new WebSocketService({ quiet: true });
function Fixture() {
  const council = useCouncilStream(service);
  const [connected, setConnected] = useState(service.isConnected);
  useEffect(() => {
    const refresh = () => setConnected(service.isConnected);
    service.on('connection', refresh); service.on('disconnection', refresh);
    service.connect();
    return () => { service.off('connection', refresh); service.off('disconnection', refresh); service.disconnect(); };
  }, []);
  return <>
    <button disabled={!connected} onClick={() => council.openCouncil(['confirmation-a', 'confirmation-b'])}>Open idle council</button>
    <output id="council-id">{council.state.councilId || 'closed'}</output>
    {council.state.councilId && <CouncilDissolve key={council.state.councilId} close={council.close}
      connected={connected} error={council.state.error} />}
    {council.state.error && <p role="alert">{council.state.error.message}</p>}
  </>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
