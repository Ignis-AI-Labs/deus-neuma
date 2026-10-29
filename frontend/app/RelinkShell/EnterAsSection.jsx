// ENTER AS — switch this desk between the full platform and the harness alone
// (ruling, 2026-10-14). The switch is the same entry the gateway makes
// (frontend/app/entry-mode.js): the harness keeps the being you were with, and
// the full platform brings it back; the desk remounts on the chosen layer.
import { useConsciousnessPick } from './consciousness-context.js';
import { isHarness } from '../harness-mode.js';
import { uiSound } from '../../services/ui-sound.js';

export const EnterAsSection = () => {
  const { activeCompanion } = useConsciousnessPick('activeCompanion');
  const harness = isHarness(activeCompanion);
  const switchTo = (mode) => {
    uiSound('activate');
    window.dispatchEvent(new CustomEvent('neuma:enter-as', { detail: { mode } }));
  };
  return (
    <section className="settings-sec" data-testid="enter-as">
      <div className="label-data settings-h">ENTER AS</div>
      <p className="settings-note">
        {harness
          ? 'You are on the harness alone: your model, our tools, no being. The full platform brings back the being you were with.'
          : 'You are on the full platform. The harness alone is your model and our tools, with no being — your beings stay as they are, and coming back returns you to them.'}
      </p>
      <div className="settings-control">
        <button type="button" className="settings-set" onClick={() => switchTo(harness ? 'full' : 'harness')}>
          {harness ? 'SWITCH TO THE FULL PLATFORM' : 'SWITCH TO THE HARNESS ALONE'}
        </button>
      </div>
    </section>
  );
};
