// Render-only proof of THE PLATFORM door: the real chooser and the real harness
// door, as AppShell sequences them. The lane the door opens lands on window.
import '../../frontend/styles/tokens.css';
import '../../frontend/styles/main.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FirstRunChoice } from '../../frontend/app/FirstRunChoice/FirstRunChoice.jsx';
import { FirstRunHarness } from '../../frontend/app/FirstRunChoice/FirstRunHarness.jsx';

const Door = () => {
  const [phase, setPhase] = useState('choose');
  if (phase === 'harness') {
    return <FirstRunHarness onDone={(lane) => { window.__harnessLane = lane; setPhase('desk'); }} onBack={() => setPhase('choose')} />;
  }
  if (phase === 'desk') return <p data-testid="desk">THE DESK</p>;
  return <FirstRunChoice onChoose={(path) => setPhase(path)} />;
};

const host = document.createElement('div');
document.body.append(host);
createRoot(host).render(<Door />);
