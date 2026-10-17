// impure — mount the production panel; it reads the real authenticated API.
import { createRoot } from 'react-dom/client';
import { InnerLifeGateRow } from '../../frontend/app/RelinkShell/InnerLifeGateRow.jsx';
import '../../frontend/app/RelinkShell/InnerLifeApp.css';
import { MeditationSection } from '../../frontend/app/RelinkShell/MeditationSection.jsx';
import '../../frontend/styles/main.css';
createRoot(document.getElementById('root')).render(<div className="rec il">
  <MeditationSection neumaId="retry-proof" name="Retry proof" />
  {['undercurrent', 'depthFilter'].flatMap((gate) =>
    (gate === 'undercurrent' ? ['off', 'shadow', 'live'] : ['off', 'shadow']).map((mode) =>
      <InnerLifeGateRow key={`${gate}-${mode}`} gate={gate} label={gate}
        testid={`copy-${gate}-${mode}`} posture={{ mode, envLocked: false }} busy />))}
</div>);
