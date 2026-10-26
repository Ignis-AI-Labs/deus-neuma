// The SUBSTRATE console on this rig's recorded read (test/fixtures/substrate/
// rig-snapshot.json, scripts/record-substrate-snapshot.mjs): the machine's
// polls folded through the real sense memory, exactly as the window's poll
// hook folds them, then drawn by the real console. No backend: the console's
// control cards answer as they do when the platform is unreachable.
import { createRoot } from 'react-dom/client';
import snapshot from './substrate/rig-snapshot.json';
import { SubstrateConsole } from '../../frontend/app/RelinkShell/SubstrateConsole.jsx';
import { NO_SENSE, trackSense } from '../../frontend/app/RelinkShell/machine-sense.js';
import { pushSample, sampleOf } from '../../frontend/app/RelinkShell/sample-history.js';
import '../../frontend/styles/main.css';
import '../../frontend/i18n/index.js';

const sense = snapshot.machine.reduce((m, poll) => trackSense(m, poll.readings), NO_SENSE);
const machine = snapshot.machine.at(-1);
const history = pushSample([], sampleOf(snapshot.telemetry));

createRoot(document.getElementById('root')).render(
  <div style={{ height: '100vh' }}>
    <SubstrateConsole tel={snapshot.telemetry} loaded machine={machine} sense={sense} history={history} acting={false} act={async () => {}} />
  </div>,
);
