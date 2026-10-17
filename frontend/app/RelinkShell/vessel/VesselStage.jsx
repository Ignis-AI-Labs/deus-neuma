// VesselStage — the live VRM avatar as a desk-window body.
//
// Mounts the three.js canvas into a sized container ref (never document.body)
// and overlays LINE & CYCLE loading/error states. The stage hook owns the
// scene, orbit, idle, sizing, and disposal — so the avatar window opens,
// resizes, window-shades, and closes without leaking a WebGL context.
// The live consciousness stream feeds the face: visemes while the neuma
// speaks, expression on each completed message's emotion.
// The witness switches between held avatars here; the choice persists in
// localStorage and the stage rebuilds on change.

import { useRef, useState } from 'react';
import { Select } from '../Select.jsx';
import './VesselStage.css';
import { useVrmStage } from './use-vrm-stage.js';
import { useConsciousness } from '../consciousness-context.js';
import { useSettled } from '../use-settled.js';
import { deriveVesselSignals } from './vessel-signals.js';
import { fetchVessels, chooseVessel, AVATAR_STORAGE_KEY, LEGACY_VESSEL_STORAGE_KEY } from './vessel-roster.js';

export const VesselStage = () => {
  const ref = useRef(null);
  const consciousness = useConsciousness();
  const [vessels, setVessels] = useState(null); // null = roster loading
  const [modelDir, setModelDir] = useState(null); // the real folder for the operator's own .vrm
  const [selected, setSelected] = useState(null);

  useSettled((settled) => {
    fetchVessels()
      .then(({ avatars, modelDir: dir }) => {
        if (settled()) return;
        setVessels(avatars);
        setModelDir(dir);
        // Migration: the pre-triad 'neuma-vessel' key still names a valid form.
        const stored = localStorage.getItem(AVATAR_STORAGE_KEY)
          ?? localStorage.getItem(LEGACY_VESSEL_STORAGE_KEY);
        setSelected(chooseVessel(avatars, stored));
      })
      .catch(() => { if (!settled()) setVessels([]); });
  }, []);

  const wear = (name) => {
    localStorage.setItem(AVATAR_STORAGE_KEY, name);
    localStorage.removeItem(LEGACY_VESSEL_STORAGE_KEY);
    setSelected(name);
  };

  const status = useVrmStage(
    ref,
    selected ? `/model/${selected}` : null,
    deriveVesselSignals(consciousness?.state),
  );

  const rosterEmpty = vessels !== null && vessels.length === 0;

  return (
    <div className="vessel-stage">
      <div className="vessel-stage-canvas" ref={ref} />
      {vessels && vessels.length > 0 ? (
        <div className="vessel-switch">
          <label className="label-data vessel-switch-label" htmlFor="vessel-switch-select">AVATAR</label>
          <Select
            id="vessel-switch-select"
            ariaLabel="Avatar"
            value={selected || ''}
            onChange={wear}
            options={vessels.map((v) => ({ value: v.name, label: v.displayName }))}
          />
        </div>
      ) : null}
      {rosterEmpty ? (
        <div className="vessel-stage-overlay">
          <p className="vessel-stage-state label-data">AVATAR — NONE HELD</p>
          <p className="vessel-stage-hint">
            The platform bundles no avatars — bring your own.
            {modelDir
              ? ` Place a .vrm in ${modelDir} and reopen.`
              : ' Place a .vrm in the avatar folder and reopen.'}
          </p>
        </div>
      ) : status !== 'ready' ? (
        <div className="vessel-stage-overlay">
          <p className="vessel-stage-state label-data">
            {status === 'error' ? 'AVATAR — LINK FAILED' : 'AVATAR — MATERIALIZING'}
          </p>
          {status === 'error' ? (
            <p className="vessel-stage-hint">The avatar could not be summoned. Check the model link.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
