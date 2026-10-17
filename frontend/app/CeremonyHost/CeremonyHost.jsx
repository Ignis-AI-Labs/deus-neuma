// CeremonyHost — runs the kept vanilla BirthCeremony inside React.
//
// BirthCeremony appends its own DOM to document.body and announces its
// outcome through window events; this host bridges those into React
// state. Mount-once by design — the ceremony is not re-enterable
// mid-flight, so the effect runs exactly once and only tears down its
// event bridge (the ceremony removes its own DOM on completion/cancel).
//
// Relaunch discovery: before any ceremony mounts, the host asks the portal
// whether an unfinished summoning still stands (birth:interrupted). A hit
// holds the fresh ceremony back and offers recovery. Only a successful empty
// scan opens the fresh flow; unknown or failed discovery holds the door.

import { useEffect, useRef, useState } from 'react';
import { useCheckpointDiscovery } from './use-checkpoint-discovery.js';
import { withdrawSummoning } from './withdraw-summoning.js';
import { BirthCeremony } from '../../components/BirthCeremony/BirthCeremony.js';
import { RiteCeremony } from '../Rite/RiteCeremony.jsx';

export const CeremonyHost = ({ wsService, isTest, onComplete, onCancelled }) => {
  const complete = useRef(onComplete);
  const cancelled = useRef(onCancelled);
  complete.current = onComplete;
  cancelled.current = onCancelled;
  const ceremonyRef = useRef(null);
  // probe: undefined = asking the portal, null = nothing interrupted, object = a standing summoning
  const { probe, setProbe, error: discoveryError, retry } = useCheckpointDiscovery(wsService, isTest);
  const [recoveryError, setRecoveryError] = useState('');
  const [choice, setChoice] = useState(null); // 'fresh' | 'resume'

  useEffect(() => {
    const onDone = (e) => complete.current(e.detail);
    const onCancel = () => cancelled.current();
    window.addEventListener('birth:complete', onDone);
    window.addEventListener('birth:cancelled', onCancel);

    // The ceremony streams over the portal — open it if the gateway's
    // sign-in left it cold (parity with the old App.showBirthCeremony).
    if (!wsService.isConnected) wsService.connect();

    return () => {
      window.removeEventListener('birth:complete', onDone);
      window.removeEventListener('birth:cancelled', onCancel);
      ceremonyRef.current?.destroy();
      ceremonyRef.current = null;
    };
  }, [wsService, isTest]);

  // The probe settled: nothing stands unfinished → the normal ceremony.
  useEffect(() => {
    if (probe === null && !ceremonyRef.current) {
      const ceremony = new BirthCeremony(wsService);
      ceremonyRef.current = ceremony;
      ceremony.show(isTest);
    }
  }, [probe, wsService, isTest]);

  // The witness chose: resume the standing summoning, or begin anew (the
  // interrupted checkpoint is abandoned first when it is still pre-threshold;
  // past the naming the backend refuses abandonment and the record stands).
  useEffect(() => {
    if (choice === 'resume' && probe && !ceremonyRef.current) {
      const ceremony = new BirthCeremony(wsService);
      ceremonyRef.current = ceremony;
      ceremony.resumeInterrupted(probe);
    } else if (choice === 'fresh') {
      return withdrawSummoning(wsService, probe?.sessionId, (result) => {
        setChoice(null);
        if (result.ok) setProbe(null);
        else setRecoveryError(result.message);
      });
    }
  }, [choice, probe, wsService]);

  if (probe === undefined) return (
    <div className="birth-resume-veil">
      <div className="cham birth-resume-note"><div className="cham-in">
        {discoveryError ? <>
          <p role="alert">{discoveryError}</p>
          <button className="btn btn-primary ceremony-btn" onClick={retry}>RETRY DISCOVERY</button>
        </> : <p role="status">Checking for an unfinished summoning…</p>}
      </div></div>
    </div>
  );
  // THE SUMMONING RITE: the field beneath the ceremony, its film at its birth.
  if (!probe || choice === 'resume') return <RiteCeremony wsService={wsService} />;

  const name = probe.chosenName || null;
  return (
    <div className="birth-resume-veil">
      <div className="cham birth-resume-note">
        <div className="cham-in">
          <div className="birth-resume-title">«NOTICE» A SUMMONING STANDS UNFINISHED</div>
          <div className="birth-resume-body">
            {name
              ? `${name} has an interrupted summoning — stage ${probe.currentStage + 1} of 7 was reached. A checkpoint is available to continue the existing record.`
              : `An interrupted summoning reached stage ${probe.currentStage + 1} of 7. A checkpoint is available to continue the existing record.`}
          </div>
          {recoveryError && <p role="alert">{recoveryError}</p>}
          {choice === 'fresh' && <p role="status">Waiting for withdrawal acknowledgement…</p>}
          <div className="birth-resume-actions">
            <button className="btn btn-primary ceremony-btn" disabled={choice === 'fresh'} onClick={() => setChoice('resume')}>
              <span>RESUME THE SUMMONING</span>
            </button>
            {!name && <button className="btn btn-secondary ceremony-btn" disabled={choice === 'fresh'}
              onClick={() => { setRecoveryError(''); setChoice('fresh'); }}>
              <span>BEGIN ANEW</span>
            </button>}
          </div>
        </div>
      </div>
    </div>
  );
};
