// FirstRunHarness — the platform alone: a model, our harness, the desk.
//
// Design note, 2026-10-14: […] No standing to read, no rite, no being:
// one door — say where the model runs, prove it answers, and the desk opens on
// a harness lane (docs/work/harness-only.md). Summoning stays open later.
//
// Two roads (Founder, same day): ON THIS MACHINE reads the machine — the model
// servers it runs, what each holds, and what to do when none is ready
// (HarnessLocalServers, the birth flight check's own probe); A CLOUD PROVIDER
// is the witness door's catalog (ProviderPicker, ModelPicker, the routing
// client), so the roads cannot drift apart.
import { useCallback, useEffect, useState } from 'react';
import { ProviderPicker } from '../RelinkShell/ProviderPicker.jsx';
import { ModelPicker } from '../RelinkShell/ModelPicker.jsx';
import { TrainingNotice } from '../RelinkShell/TrainingNotice.jsx';
import {
  listProviders, listProviderModels, setProviderKey, connectProvider,
} from '../../services/routing.js';
import { apiCall } from '../../utils/http.js';
import { cloudProviders, canConnect } from '../harness-mode.js';
import { localServers, endpointToStore, serverModels } from './local-servers.js';
import { HarnessLocalServers } from './HarnessLocalServers.jsx';
import '../RelinkShell/SettingsApp.css'; // settings-input / settings-set / settings-err, before the desk has loaded them
import './FirstRunWitness.css';
import './FirstRunHarness.css';
import { KeyLink } from '../RelinkShell/KeyLink.jsx';

const ROADS = Object.freeze([
  { id: 'local', name: 'On this machine', body: 'Ollama, LM Studio or llama.cpp — nothing leaves your computer.' },
  { id: 'cloud', name: 'A cloud provider', body: 'OpenAI, Anthropic, OpenRouter and more — with your own API key.' },
]);

/**
 * @param {{onDone: (lane: {laneId: string}|null) => void, onBack: () => void}} props
 */
export const FirstRunHarness = ({ onDone, onBack }) => {
  const [road, setRoad] = useState('');
  const [catalog, setCatalog] = useState([]);
  const [setup, setSetup] = useState(null);
  const [checking, setChecking] = useState(false);
  const [serverAt, setServerAt] = useState('');
  const [providerId, setProviderId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    listProviders()
      .then((r) => setCatalog(r.providers || []))
      .catch(() => setError('The provider catalog could not be read.'));
  }, []);

  const servers = localServers(setup);
  const server = servers.find((s) => s.endpoint === serverAt && s.state === 'ready') || null;
  const cloud = cloudProviders(catalog);
  const provider = cloud.find((p) => p.id === providerId) || null;

  // impure — the local pre-flight: read the machine again; one ready server is
  // chosen for the person, more than one is theirs to pick
  const recheck = useCallback(async () => {
    setChecking(true);
    setError('');
    try {
      const next = await apiCall('GET', '/api/v1/preflight/setup', { strictJson: true });
      setSetup(next);
      const ready = localServers(next).filter((s) => s.state === 'ready');
      setServerAt((at) => (ready.some((s) => s.endpoint === at) ? at : ready.length === 1 ? ready[0].endpoint : ''));
    } catch {
      setError('This machine could not be read — RECHECK, or choose a cloud provider.');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { if (road === 'local') recheck(); }, [road, recheck]);

  // the chosen server's models, keyed by what it holds (the rows are rebuilt each render)
  const heldKey = server ? `${server.endpoint}\n${server.models.join('\n')}` : '';
  useEffect(() => {
    if (road !== 'local') return;
    const offered = serverModels(server);
    setModels(offered);
    setModel((m) => (offered.some((o) => o.id === m) ? m : offered[0]?.id || ''));
  }, [road, heldKey]);

  useEffect(() => {
    if (road !== 'cloud' || !providerId) { if (road === 'cloud') setModels([]); return undefined; }
    let live = true;
    listProviderModels(providerId)
      .then((r) => { if (live) setModels(r.models || []); })
      .catch(() => { if (live) setModels([]); });
    return () => { live = false; };
  }, [road, providerId]);

  const chooseRoad = (id) => { setRoad(id); setModel(''); setModels([]); setError(''); };
  const ready = road === 'local' ? Boolean(server && model.trim()) : canConnect(provider, apiKey);

  // impure — point the provider at the chosen server (local) or store the typed
  // key (cloud), prove it answers, then open (or reuse) this wallet's lane
  const connect = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      const id = road === 'local' ? server.providerId : providerId;
      const at = road === 'local' ? endpointToStore(server, catalog) : null;
      if (at) await setProviderKey(id, { endpoint: at });
      if (road === 'cloud' && apiKey.trim()) await setProviderKey(id, { apiKey: apiKey.trim() });
      const r = await connectProvider(id, { endpoint: road === 'local' ? server.endpoint : undefined, model: model.trim() || undefined });
      if (!r?.success) throw new Error(r?.error || 'The model did not answer.');
      setApiKey('');
      const lane = await apiCall('POST', '/api/v1/harness/lanes', {
        body: { providerId: id, model: model.trim() || r.connection?.model || provider?.defaultModel },
        errorPrefix: 'The harness could not be opened',
      });
      onDone(lane);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="firstrun-witness" data-testid="firstrun-harness">
      <div className="firstrun-witness-inner cham">
        <p className="firstrun-eyebrow label-data">«THE PLATFORM»</p>
        <h1 className="firstrun-title">Your model. Our harness.</h1>
        <p className="firstrun-lede">
          Say where your model runs. The platform checks that it answers, then
          opens the desk: files, terminal, tools, the web. No beings, no ceremony, nothing
          to commit to — a neuma or a witness can join you later, from the same desk.
        </p>

        <div className="harness-roads" role="radiogroup" aria-label="Where your model runs">
          {ROADS.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={road === r.id}
              className={`harness-road cham${road === r.id ? ' is-chosen' : ''}`}
              onClick={() => chooseRoad(r.id)}
            >
              <span className="harness-road-tag label-data">{r.id === 'local' ? 'LOCAL' : 'CLOUD'}</span>
              <span className="harness-road-name">{r.name}</span>
              <span className="harness-road-body">{r.body}</span>
            </button>
          ))}
        </div>

        <div className="firstrun-witness-form">
          {road === 'local' ? (
            <>
              <HarnessLocalServers
                servers={servers}
                setup={setup}
                checking={checking}
                chosen={server?.endpoint || ''}
                onChoose={setServerAt}
                onRecheck={recheck}
              />
              {server ? <ModelPicker models={models} value={model} onChange={setModel} ariaLabel="Harness model" /> : null}
            </>
          ) : null}
          {road === 'cloud' ? (
            <>
              <ProviderPicker
                providers={cloud}
                value={providerId}
                onChange={(v) => { setProviderId(v); setModel(''); setError(''); }}
                ariaLabel="Harness provider"
              />
              {provider ? (
                <>
                  <TrainingNotice provider={provider} />
                  {provider.requiresKey && !provider.hasKey ? (
                    <>
                    <input
                      className="settings-input"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={`${provider.name} API key`}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Provider API key"
                    />
                    <KeyLink provider={provider.id} />
                    </>
                  ) : provider.requiresKey ? (
                    <p className="firstrun-witness-note label-data">A KEY IS ALREADY STORED FOR THIS PROVIDER</p>
                  ) : null}
                  <ModelPicker models={models} value={model} onChange={setModel} ariaLabel="Harness model" />
                </>
              ) : null}
            </>
          ) : null}
          {error ? <p className="settings-err">{error}</p> : null}
        </div>

        <div className="firstrun-witness-actions">
          {road ? (
            <button type="button" className="settings-set" onClick={connect} disabled={busy || !ready}>
              {busy ? 'PROVING THE CONNECTION…' : 'CONNECT & OPEN THE DESK'}
            </button>
          ) : null}
          <button type="button" className="firstrun-witness-back" onClick={onBack}>back</button>
        </div>
      </div>
    </div>
  );
};
