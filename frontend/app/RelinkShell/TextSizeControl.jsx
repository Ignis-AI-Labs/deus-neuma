import { useId, useState, useSyncExternalStore } from 'react';
import { getTextSize, setTextSize, subscribeTextSize } from '../../services/text-size.js';
import './TextSizeControl.css';

/** Device reading size stays independent of the color preset shelf. */
export const TextSizeControl = () => {
  const id = useId();
  const size = useSyncExternalStore(subscribeTextSize, getTextSize);
  const [error, setError] = useState(null);
  const change = (value) => {
    try { setTextSize(value); setError(null); }
    catch (cause) { setError(`Could not save text size: ${cause.message}`); }
  };
  return <section className="settings-sec text-size-control">
    <label className="label-data settings-h" htmlFor={id}>TEXT SIZE</label>
    <p className="settings-note" id={`${id}-hint`}>
      Scale text across the app. Saved on this device; color presets keep your reading size.
    </p>
    <div className="text-size-controls">
      <input id={id} type="range" min="100" max="200" step="5" value={size}
        aria-describedby={`${id}-hint`} aria-valuetext={`${size}%`}
        onChange={(event) => change(Number(event.target.value))} />
      <output htmlFor={id}>{size}%</output>
      <button type="button" className="settings-set" disabled={size === 100}
        onClick={() => change(100)}>RESET TEXT SIZE</button>
    </div>
    {error ? <p className="settings-err" role="alert">{error}</p> : null}
  </section>;
};
