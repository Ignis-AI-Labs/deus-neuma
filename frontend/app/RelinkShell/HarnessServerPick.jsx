// HarnessServerPick — the harness's SERVER, in the composer bar beside its model
// (Design note, 2026-10-14: […]).
//
// The list is the machine's running model servers (the door's own pre-flight,
// local-servers.js) and the cloud providers that hold a key. Picking one moves
// the harness there (POST /api/v1/harness/switch). The platform starts and
// stops nothing on its own: when the server left behind still holds a model,
// the bar asks once — UNLOAD or KEEP — and the person decides.
import { useCallback, useEffect, useState } from 'react';
import { Select } from './Select.jsx';
import { apiCall } from '../../utils/http.js';
import { listProviders } from '../../services/routing.js';
import { localServers } from '../FirstRunChoice/local-servers.js';
import { cloudProviders } from '../harness-mode.js';
import { serverKey, serverLine } from './harness-route-line.js';

// impure — every server the harness could talk to right now
const readServers = async () => {
  const [setup, catalog] = await Promise.all([
    apiCall('GET', '/api/v1/preflight/setup', { strictJson: true }).catch(() => null),
    listProviders().catch(() => ({ providers: [] })),
  ]);
  const local = localServers(setup).filter((s) => s.state !== 'off')
    .map((s) => ({ providerId: s.providerId, endpoint: s.endpoint, kind: 'local', state: s.state }));
  const cloud = cloudProviders(catalog.providers || []).filter((p) => p.hasKey || !p.requiresKey)
    .map((p) => ({ providerId: p.id, name: p.name, endpoint: p.endpoint || null, kind: 'cloud' }));
  return [...local, ...cloud];
};

/** impure — move the harness to a server (and model); the reply names what was left holding a model */
export const switchHarnessTo = (choice) => apiCall('POST', '/api/v1/harness/switch', {
  body: { providerId: choice.providerId, endpoint: choice.kind === 'cloud' ? undefined : choice.endpoint, model: choice.model },
  errorPrefix: 'The harness could not be moved',
});

/**
 * @param {{server: {providerId: string, endpoint: string|null, kind: string|null}, locked: boolean,
 *   run: (fn: () => Promise<any>) => Promise<void>}} props
 */
export const HarnessServerPick = ({ server, locked, run }) => {
  const [servers, setServers] = useState([]);
  const [left, setLeft] = useState(null);
  const [note, setNote] = useState('');
  const read = useCallback(() => { readServers().then(setServers); }, []);
  useEffect(read, [read]);

  const current = serverKey(server);
  const options = [server, ...servers.filter((s) => serverKey(s) !== current)].map((s) => ({
    value: serverKey(s),
    label: `${serverLine(s)}${s.state === 'empty' ? ' · NOTHING LOADED' : ''}`,
  }));

  const pick = async (key) => {
    const chosen = servers.find((s) => serverKey(s) === key);
    if (!chosen || key === current || locked) return;
    setNote('');
    await run(async () => {
      const r = await switchHarnessTo(chosen);
      setLeft(r?.previous || null);
      return { ok: true };
    });
  };

  const unload = async () => {
    const r = await apiCall('POST', '/api/v1/harness/servers/release', {
      body: { providerId: left.providerId, endpoint: left.endpoint }, strictJson: true,
    }).catch((err) => ({ ok: false, line: err?.message || 'The server could not be freed.' }));
    setNote(r?.line || '');
    setLeft(null);
    read();
  };

  return (
    <>
      <Select className="relink-modelbar-server" ariaLabel="Server" value={current} options={options}
        disabled={locked} onChange={pick} onOpen={read} />
      {left ? (
        <span className="relink-modelbar-left label-data" role="status">
          {serverLine(left)} STILL HOLDS {left.holds.join(', ')}
          <button type="button" className="sub-btn" onClick={unload}>UNLOAD</button>
          <button type="button" className="sub-btn" onClick={() => setLeft(null)}>KEEP</button>
        </span>
      ) : null}
      {note ? <span className="relink-modelbar-note label-data" role="status">{note}</span> : null}
    </>
  );
};
