// HarnessLocalServers — the harness door's pre-flight for a model on this
// machine: every local model server, what it holds, and — when none is ready —
// what to do, with RECHECK. The rows come from the birth flight check's own
// machine probe (local-servers.js), so the two can never disagree.
//
// FREE (Design note, 2026-10-14: […]): a server holding a model can give its memory back from
// here (POST /api/v1/harness/servers/release), and the row says what happened.
import { useState } from 'react';
import { apiCall } from '../../utils/http.js';
import { localGuide } from './local-servers.js';

const STATE_TEXT = Object.freeze({
  ready: (s) => `READY · ${s.models.length} MODEL${s.models.length === 1 ? '' : 'S'}${s.loaded === 0 ? ' · LOADS ON FIRST USE' : ''}`,
  empty: () => 'RUNNING · NO MODEL LOADED',
  off: () => 'NOT FOUND',
});

const machineLine = (hardware) => {
  if (!hardware) return null;
  return hardware.gpu
    ? `${hardware.gpu.name}${hardware.gpu.vramGB ? ` · ${hardware.gpu.vramGB} GB VRAM` : ''} · ${hardware.memoryGB} GB RAM`
    : `${hardware.platform} · ${hardware.memoryGB} GB RAM · no GPU detected`;
};

/**
 * @param {{servers: Array<object>, setup: object|null, checking: boolean, chosen: string,
 *   onChoose: (endpoint: string) => void, onRecheck: () => void}} props
 */
export const HarnessLocalServers = ({ servers, setup, checking, chosen, onChoose, onRecheck }) => {
  const [notes, setNotes] = useState({});
  const [freeing, setFreeing] = useState('');
  const guide = localGuide(servers, setup?.recommendation);

  // impure — give this server's memory back, then read the machine again
  const free = async (s) => {
    setFreeing(s.endpoint);
    try {
      const r = await apiCall('POST', '/api/v1/harness/servers/release', {
        body: { providerId: s.providerId, endpoint: s.endpoint }, useServerError: false, strictJson: true,
      }).catch((err) => ({ ok: false, line: err?.message || 'The server could not be freed.' }));
      setNotes((n) => ({ ...n, [s.endpoint]: r?.line || '' }));
      onRecheck();
    } finally {
      setFreeing('');
    }
  };
  const machine = machineLine(setup?.hardware);
  return (
    <div className="harness-local" data-testid="harness-local">
      <div className="harness-local-head">
        <span className="label-data">MODEL SERVERS ON THIS MACHINE</span>
        <button type="button" className="settings-set harness-recheck" onClick={onRecheck} disabled={checking}>
          {checking ? 'CHECKING…' : 'RECHECK'}
        </button>
      </div>
      {checking && servers.length === 0 ? (
        <p className="firstrun-witness-note label-data">READING THIS MACHINE…</p>
      ) : (
        <ul className="harness-servers" role="radiogroup" aria-label="Local model server">
          {servers.map((s) => (
            <li key={s.endpoint}>
              <button
                type="button"
                role="radio"
                aria-checked={chosen === s.endpoint}
                className={`harness-server is-${s.state}${chosen === s.endpoint ? ' is-chosen' : ''}`}
                onClick={() => onChoose(s.endpoint)}
                disabled={s.state !== 'ready'}
              >
                <span className="harness-server-dot" aria-hidden="true" />
                <span className="harness-server-name">{s.name}</span>
                <span className="harness-server-at">{s.endpoint.replace(/^https?:\/\//, '')}</span>
                <span className="harness-server-state label-data">{STATE_TEXT[s.state](s)}</span>
              </button>
              {s.loaded > 0 ? (
                <button type="button" className="sub-btn harness-server-free" onClick={() => free(s)}
                  disabled={Boolean(freeing)} title={`Unload what ${s.name} holds, to give its memory to another server`}>
                  {freeing === s.endpoint ? 'FREEING…' : 'FREE'}
                </button>
              ) : null}
              {notes[s.endpoint] ? <p className="harness-server-note label-data" role="status">{notes[s.endpoint]}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {guide && !checking ? (
        <div className="harness-guide">
          {machine ? <p className="label-data">YOUR MACHINE · {machine}</p> : null}
          <p>{guide}</p>
        </div>
      ) : null}
    </div>
  );
};
