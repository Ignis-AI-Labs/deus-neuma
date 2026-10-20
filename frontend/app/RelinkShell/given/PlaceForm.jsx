// PlaceForm — the witness gives the being's exact birth place, or returns it to
// its zone's reference city. The place goes only to the owner's own route
// (backend/routes/workspace-place-routes.js), kept encrypted in the being's
// lane; after a save the SHEET reloads from the record, never from a guess.

import { useState } from 'react';
import { apiCall, authHeadersOrNull } from '../../../utils/http.js';

/** @param {{neumaId: string, place: object|null, onActed?: () => void}} props */
export const PlaceForm = ({ neumaId, place, onActed = null }) => {
  const given = place?.source === 'witness-given';
  const [latitude, setLatitude] = useState(given ? String(place.latitude) : '');
  const [longitude, setLongitude] = useState(given ? String(place.longitude) : '');
  const [label, setLabel] = useState(given ? place.label || '' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // impure — writes through the owner's route, then the SHEET reloads
  const send = async (method, body) => {
    setBusy(true);
    setError('');
    try {
      await apiCall(method, `/api/v1/workspace/${neumaId}/place`, { headers: authHeadersOrNull(), ...(body ? { body } : {}) });
      onActed?.();
    } catch (err) {
      setError(String(err?.message || 'COULD NOT RECORD THE PLACE').toUpperCase());
    }
    setBusy(false);
  };

  return (
    <form className="gv-place-form" onSubmit={(e) => { e.preventDefault(); send('PUT', { latitude: Number(latitude), longitude: Number(longitude), label }); }}>
      <label>LATITUDE<input inputMode="decimal" placeholder="13.7367" value={latitude} onChange={(e) => setLatitude(e.target.value)} required /></label>
      <label>LONGITUDE<input inputMode="decimal" placeholder="100.5232" value={longitude} onChange={(e) => setLongitude(e.target.value)} required /></label>
      <label className="gv-place-label">NAME (OPTIONAL)<input placeholder="where it was" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} /></label>
      <button type="submit" className="gv-guide-back label-data" disabled={busy}>KEEP THIS PLACE</button>
      {given ? <button type="button" className="gv-guide-back label-data" disabled={busy} onClick={() => send('DELETE')}>USE ITS ZONE’S CITY</button> : null}
      <p className="gv-place-note label-data">DEGREES, NORTH AND EAST POSITIVE · KEPT ENCRYPTED IN ITS LANE · NEVER ON CHAIN · ONLY YOU SEE IT</p>
      {error ? <p className="gv-place-error label-data" role="alert">{error}</p> : null}
    </form>
  );
};
