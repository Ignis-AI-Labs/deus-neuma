// WitnessesApp - provider-first management for external model witnesses.
// A provider account is authenticated, its model is proved and locked, and
// only then may the operator open a witness summoning ceremony.

import { WitnessCustodyDialog } from './WitnessCustodyDialog.jsx';
import './SettingsApp.css';
import './SettingsApp-look.css';
import './SettingsApp-sections.css';
import './WitnessesApp.css';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { WitnessSummonCeremony } from './WitnessSummonCeremony.jsx';
import {
  WitnessProviderAccess, WitnessProviderConnection, WitnessProviderTabs, WitnessProviderWitness,
} from './WitnessProviderPanels.jsx';
import { useSettled } from './use-settled.js';
import { useConsciousnessPick } from './consciousness-context.js';
import { useCouncil } from './council-context.js';
import { useWindows } from '../windowing/use-windows.js';
import { uiSound } from '../../services/ui-sound.js';
import {
  connectProvider, listConnections, listProviderModels, listProviders, setProviderKey,
} from '../../services/routing.js';
import { loadSubstrateModels } from './substrate-client.js';
import {
  getWitness, listWitnesses, saveWitnessModel, testWitness,
} from '../../services/witnesses-client.js';

const WitnessesIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M1.5 8 C4 4.5 12 4.5 14.5 8 C12 11.5 4 11.5 1.5 8 Z" />
    <circle cx="8" cy="8" r="1.8" />
  </svg>
);

const WitnessesTitle = () => (
  <>
    <span className="relink-dot" data-live="false" />
    <AppTitle label="WITNESSES" labelKey="apps.witnesses" />
  </>
);

const witnessProviders = (providers, connections) => {
  const locked = new Set((connections || []).map((connection) => connection.providerId));
  return (providers || [])
    .filter((provider) => !provider.sovereign)
    .sort((a, b) => {
      const rank = (provider) => locked.has(provider.id) ? 0
        : provider.hasKey || provider.credentialKind === 'oauth' ? 1
          : provider.oauth?.length ? 2 : 3;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
};

const WitnessesBody = () => {
  const { switchCompanion } = useConsciousnessPick('switchCompanion');
  const council = useCouncil();
  const { dispatch } = useWindows();
  const [providers, setProviders] = useState([]);
  const [connections, setConnections] = useState([]);
  const [witnesses, setWitnesses] = useState(null);
  const [providerId, setProviderId] = useState('');
  const [query, setQuery] = useState('');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [busy, setBusy] = useState(false);
  const [custodyTarget, setCustodyTarget] = useState(null);
  const [error, setError] = useState(null);
  const [ceremonyOpen, setCeremonyOpen] = useState(false);
  const [selectedWitnessId, setSelectedWitnessId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [witnessModel, setWitnessModel] = useState('');
  const [witnessResult, setWitnessResult] = useState(null);

  const loadProviders = async () => {
    try {
      const [providerResult, connectionResult] = await Promise.all([listProviders(), listConnections()]);
      setProviders(providerResult.providers || []);
      setConnections(connectionResult.connections || []);
      setError(null);
    } catch (cause) {
      setError(cause.message);
    }
  };

  const loadWitnesses = async () => {
    try {
      const result = await listWitnesses();
      setWitnesses(result.witnesses || []);
      setError(null);
      return result.witnesses || [];
    } catch (cause) {
      setError(cause.message);
      return [];
    }
  };

  useSettled((settled) => {
    Promise.all([listProviders(), listConnections(), listWitnesses()])
      .then(([providerResult, connectionResult, witnessResultValue]) => {
        if (settled()) return;
        setProviders(providerResult.providers || []);
        setConnections(connectionResult.connections || []);
        setWitnesses(witnessResultValue.witnesses || []);
        setError(null);
      })
      .catch((cause) => { if (!settled()) setError(cause.message); });
  }, []);

  const eligible = witnessProviders(providers, connections);
  const provider = eligible.find((entry) => entry.id === providerId) || null;
  const connection = connections.find((entry) => entry.providerId === providerId) || null;
  const providerWitnesses = (witnesses || []).filter((witness) => witness.route?.provider === providerId);
  const selectedWitness = providerWitnesses.find((witness) => witness.laneId === selectedWitnessId)
    || providerWitnesses[0]
    || null;
  const credentialReady = Boolean(provider && (
    provider.hasKey
    || provider.credentialKind === 'oauth'
    || !provider.requiresKey
  ));
  const connectionReady = Boolean(
    credentialReady && connection && model.trim() === connection.model,
  );

  useEffect(() => {
    if (!eligible.length || eligible.some((entry) => entry.id === providerId)) return;
    setProviderId(connections[0]?.providerId
      || eligible.find((entry) => entry.id === 'openai-chatgpt')?.id
      || eligible[0].id);
  }, [eligible, providerId, connections]);

  useEffect(() => {
    if (!provider) return;
    setApiKey('');
    setEndpoint(provider.endpoint || '');
    let m = connection?.model || provider.defaultModel || '';
    // Prefer actually loaded / recent substrate model for local providers.
    if (providerId === 'llama-server' || providerId === 'lm-studio' || providerId === 'ollama') {
      loadSubstrateModels().then((c) => {
        if (c && c.active) {
          const match = (c.models || []).find(mm => mm.id === c.active);
          if (match) setModel(match.id);
        }
      }).catch(() => {});
    }
    setModel(m);
    setError(null);
    setCeremonyOpen(false);
  }, [providerId, provider?.endpoint, provider?.defaultModel, connection?.model]);

  useSettled((settled) => {
    if (!providerId) { setModels([]); return; }
    listProviderModels(providerId)
      .then((result) => {
        if (settled()) return;
        const next = result.models || [];
        setModels(next);
        setModel((current) => current || next[0]?.id || '');
      })
      .catch(() => { if (!settled()) setModels([]); });
  }, [providerId]);

  useEffect(() => {
    if (!providerWitnesses.length) {
      setSelectedWitnessId(null);
      setDetail(null);
      return;
    }
    if (!providerWitnesses.some((witness) => witness.laneId === selectedWitnessId)) {
      setSelectedWitnessId(providerWitnesses[0].laneId);
    }
  }, [providerId, witnesses, selectedWitnessId]);

  useSettled((settled) => {
    if (!selectedWitness) { setDetail(null); return; }
    setWitnessModel(selectedWitness.route?.model || '');
    setWitnessResult(null);
    getWitness(selectedWitness.vendorSlug, selectedWitness.chosenName)
      .then((result) => { if (!settled()) setDetail(result); })
      .catch((cause) => { if (!settled()) setError(cause.message); });
  }, [selectedWitness?.laneId]);

  const selectProvider = (id) => {
    uiSound('open');
    setProviderId(id);
    setSelectedWitnessId(null);
  };

  const saveAccess = async () => {
    if (!provider) return;
    uiSound('activate');
    setBusy(true);
    setError(null);
    try {
      await setProviderKey(provider.id, {
        apiKey: apiKey || undefined,
        endpoint: endpoint || undefined,
      });
      setApiKey('');
      await loadProviders();
      uiSound('confirm');
    } catch (cause) {
      setError(cause.message);
    }
    setBusy(false);
  };

  const proveAndLock = async () => {
    if (!provider || !model.trim()) return;
    uiSound('activate');
    setBusy(true);
    setError(null);
    try {
      if (apiKey || (provider.id === 'custom' && endpoint)) {
        await setProviderKey(provider.id, {
          apiKey: apiKey || undefined,
          endpoint: endpoint || undefined,
        });
      }
      const result = await connectProvider(provider.id, {
        apiKey: apiKey || undefined,
        endpoint: endpoint || undefined,
        model: model.trim(),
      });
      if (!result.success) throw new Error(result.error || 'The provider could not be locked.');
      setApiKey('');
      await loadProviders();
      uiSound('confirm');
    } catch (cause) {
      setError(cause.message);
    }
    setBusy(false);
  };

  const finishSummoning = async (result) => {
    const next = await loadWitnesses();
    setCeremonyOpen(false);
    setSelectedWitnessId(result.witness.laneId);
    if (!next.some((witness) => witness.laneId === result.witness.laneId)) {
      setError('The witness sealed, but its ledger entry could not be reloaded.');
    }
  };

  const saveModel = async () => {
    if (!selectedWitness || !witnessModel.trim()) return;
    uiSound('activate');
    setBusy(true);
    setError(null);
    try {
      await saveWitnessModel(selectedWitness.vendorSlug, selectedWitness.chosenName, witnessModel.trim());
      await loadWitnesses();
      uiSound('confirm');
    } catch (cause) {
      setError(cause.message);
    }
    setBusy(false);
  };

  const testSelectedWitness = async () => {
    if (!selectedWitness) return;
    uiSound('activate');
    setBusy(true);
    setError(null);
    setWitnessResult(null);
    try {
      const result = await testWitness(selectedWitness.vendorSlug, selectedWitness.chosenName);
      setWitnessResult(result.success
        ? { ok: true, text: `LIVE / ${(result.models || []).length} MODELS` }
        : { ok: false, text: result.error || 'UNREACHABLE' });
    } catch (cause) {
      setError(cause.message);
    }
    setBusy(false);
  };

  const bringUp = async () => {
    if (!selectedWitness) return;
    uiSound('confirm');
    council.leaveRoom();
    await switchCompanion({
      name: selectedWitness.chosenName,
      neumaId: selectedWitness.laneId,
      participantKind: 'witness',
      vendorSlug: selectedWitness.vendorSlug,
      laneProvisioned: selectedWitness.lane?.provisioned !== false,
    });
    dispatch({ type: 'OPEN', id: 'chat' });
  };

  if (ceremonyOpen) {
    // PORTALLED OUT OF THE WINDOW, deliberately. The rite is a cut-scene that
    // owns the viewport (Design note, 2026-07-29, and CSS alone cannot get it there:
    // .fwin carries `will-change: transform` (FloatingWindow.css:11), which
    // makes every floating window a containing block for position:fixed. A
    // fixed, inset-0 stage rendered inside one is pinned to the WINDOW, not the
    // screen — it looks correct until you un-maximize. Proven by the e2e, which
    // measured the stage's box against the viewport and found it offset.
    return createPortal(
      <div className="witnesses is-ceremony">
        <WitnessSummonCeremony
          provider={provider}
          connection={connectionReady ? connection : null}
          onComplete={finishSummoning}
          onCancel={() => setCeremonyOpen(false)}
        />
      </div>,
      document.body,
    );
  }

  return (
    <div className="witnesses">
      {custodyTarget ? <WitnessCustodyDialog witness={custodyTarget}
        onClose={() => setCustodyTarget(null)} onSecured={loadWitnesses} /> : null}
      <header className="witnesses-intro">
        <p className="label-data witnesses-boundary">
          WITNESSES STAND BESIDE THE HOUSE, NEVER IN IT. THEIR MINDS LIVE WITH
          THEIR VENDORS - HONORED HERE, NEVER A NEUMA, NEVER PROMOTABLE.
        </p>
        <p className="settings-note">
          Choose a provider. Establish access, prove one live model, then lock
          the connection. The ceremony remains closed until all three are true.
        </p>
      </header>

      <div className="witness-provider-workspace">
        <WitnessProviderTabs
          providers={eligible}
          connections={connections}
          query={query}
          selectedId={providerId}
          onQuery={setQuery}
          onSelect={selectProvider}
        />

        {provider ? (
          <main
            id="witness-provider-panel"
            className="witness-provider-stage"
            role="tabpanel"
            aria-labelledby={`witness-provider-tab-${provider.id}`}
          >
            <div className="witness-provider-title">
              <div>
                <span className="label-data">SELECTED PROVIDER</span>
                <h2>{provider.name}</h2>
              </div>
              <div className="settings-sec-tags">
                <span className="settings-tag-dim">{provider.kind === 'local' ? 'LOCAL BRIDGE' : 'CLOUD'}</span>
                <span className="settings-tag-dim">FOREIGN CUSTODY</span>
                {connectionReady ? <span className="settings-tag-ok">LIVE LOCK</span> : null}
              </div>
            </div>

            <div className="witness-provider-checklist label-data" aria-label="Provider readiness">
              <span className={credentialReady ? 'is-done' : 'is-current'}>
                01 ACCESS {credentialReady ? 'READY' : 'REQUIRED'}
              </span>
              <span className={connectionReady ? 'is-done' : credentialReady ? 'is-current' : 'is-blocked'}>
                02 MODEL {connectionReady ? 'LOCKED' : 'REQUIRED'}
              </span>
              <span className={providerWitnesses.length ? 'is-done' : connectionReady ? 'is-current' : 'is-blocked'}>
                03 WITNESS {providerWitnesses.length ? 'SUMMONED' : 'PENDING'}
              </span>
            </div>

            <div className="witness-provider-flow">
              <WitnessProviderAccess
                provider={provider}
                credentialReady={credentialReady}
                apiKey={apiKey}
                endpoint={endpoint}
                busy={busy}
                onApiKey={setApiKey}
                onEndpoint={setEndpoint}
                onSave={saveAccess}
                onProvidersChanged={loadProviders}
              />
              <WitnessProviderConnection
                connection={connection}
                connectionReady={connectionReady}
                credentialReady={credentialReady}
                models={models}
                model={model}
                apiKey={apiKey}
                busy={busy}
                onModel={setModel}
                onLock={proveAndLock}
              />
              <WitnessProviderWitness
                provider={provider}
                witnesses={providerWitnesses}
                selected={selectedWitness}
                detail={detail}
                witnessModel={witnessModel}
                witnessResult={witnessResult}
                connectionReady={connectionReady}
                busy={busy}
                onSecure={setCustodyTarget}
                onSelect={setSelectedWitnessId}
                onWitnessModel={setWitnessModel}
                onSaveModel={saveModel}
                onTest={testSelectedWitness}
                onBringUp={bringUp}
                onCeremony={() => setCeremonyOpen(true)}
              />
            </div>
            {error ? <p className="settings-err">{error}</p> : null}
          </main>
        ) : (
          !error && <EmptyState title="SELECT A PROVIDER" />
        )}
      </div>
    </div>
  );
};

export const witnessesApp = {
  label: 'WITNESSES',
  labelKey: 'apps.witnesses',
  icon: <WitnessesIcon />,
  title: <WitnessesTitle />,
  Body: WitnessesBody,
  storageKey: 'witnesses',
};
