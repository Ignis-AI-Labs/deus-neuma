// GpuDriverNotice — the graphics driver is older than this card needs (backend gpu-driver-guard.js):
// said plainly where the model is set up and checked, with the update link (target=_blank opens
// the system browser, desk-links.cjs), and the person's own choice to use the card anyway or to
// go back to the processor (POST /api/v1/model-server/gpu-driver, the install owner's).
//
// impure — the choice is sent to the backend.
import { useState } from 'react';
import { apiCall } from '../../utils/http.js';

/**
 * @param {{notice: {line: string, link: string, hold: boolean, overridden: boolean}|null, onChange: () => void}} props
 *   onChange — read the machine again once the choice is kept
 */
export const GpuDriverNotice = ({ notice, onChange }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!notice) return null;
  const choose = async (useGpuAnyway) => {
    setBusy(true);
    setError('');
    const r = await apiCall('POST', '/api/v1/model-server/gpu-driver', { body: { useGpuAnyway }, useServerError: true, strictJson: true })
      .catch((err) => ({ error: err?.message || 'The choice could not be kept.' }));
    setBusy(false);
    if (r.error) setError(r.error);
    else onChange();
  };
  return (
    <div className="harness-setup-note" role="alert" data-testid="gpu-driver-notice">
      <p>{notice.line}</p>
      <p>
        <a className="label-data" href={notice.link} target="_blank" rel="noreferrer">UPDATE THE GRAPHICS DRIVER ↗</a>
        {' '}
        <button type="button" className="sub-btn" disabled={busy} onClick={() => choose(notice.hold)}>
          {notice.hold ? 'USE THE GRAPHICS CARD ANYWAY' : 'KEEP THE MODEL ON THE PROCESSOR'}
        </button>
      </p>
      {error ? <p>{error}</p> : null}
    </div>
  );
};
