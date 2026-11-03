import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useConsciousnessPick } from './consciousness-context.js';
import { readSandboxModePref, writeSandboxModePref } from './stream-preferences.js';
import { uiSound } from '../../services/ui-sound.js';

const SandboxToggleView = ({ disabled }) => {
  const { wsService, activeCompanion } = useConsciousnessPick('wsService', 'activeCompanion');
  const laneId = activeCompanion?.neumaId;
  const [enabled, setEnabled] = useState(() => readSandboxModePref(laneId));
  const [refusal, setRefusal] = useState('');
  const preference = useRef(enabled);

  useEffect(() => {
    const next = readSandboxModePref(laneId);
    preference.current = next;
    setEnabled(next);
    setRefusal('');
    if (!wsService) return undefined;
    const declare = () => {
      if (wsService.isConnected) wsService.send('sandbox:mode', { enabled: preference.current });
    };
    const onMode = (data) => {
      if (typeof data.enabled !== 'boolean') return;
      preference.current = data.enabled;
      setEnabled(data.enabled);
      setRefusal(data.error || '');
    };
    wsService.on('connection', declare);
    wsService.on('sandbox:mode', onMode);
    declare();
    return () => {
      wsService.off('connection', declare);
      wsService.off('sandbox:mode', onMode);
    };
  }, [wsService, laneId]);

  const toggle = useCallback(() => {
    const next = !preference.current;
    writeSandboxModePref(laneId, next);
    preference.current = next;
    setRefusal('');
    uiSound('toggle');
    if (wsService?.isConnected) wsService.send('sandbox:mode', { enabled: next });
    else setEnabled(next);
  }, [wsService, laneId]);

  const title = refusal || (enabled
    ? 'SANDBOX ON — commands use the isolated shell. Click for direct execution.'
    : 'SANDBOX OFF — commands run directly with your normal environment. Click to isolate them.');
  return (
    <div className="relink-mode-root">
      <button
        type="button"
        className={`relink-mode-chip ${enabled ? 'is-on' : 'is-off'}`}
        disabled={disabled}
        aria-pressed={enabled}
        title={title}
        onClick={toggle}
      >
        {`SANDBOX ${enabled ? 'ON' : 'OFF'}`}
      </button>
      {refusal ? <span className="relink-sandbox-refusal" role="alert">OWNER AT DESK ONLY</span> : null}
    </div>
  );
};

export const SandboxToggle = memo(SandboxToggleView);
