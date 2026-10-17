// ModelsSection — the witness's model-route panel inside Settings.
//
// Two truths, matching the backend split:
//   • PROVIDERS — the operator's API credentials (keys, base URLs). Stored
//     ENCRYPTED on this machine; a raw key never returns here. Local providers
//     (LM Studio, Ollama) need no key. This is machine-scoped, not per-being.
//     A provider can also be CONNECTED — proved live, then LOCKED; locked
//     connections are the pool new sealed witnesses are summoned from.
//   • MODEL (per being) — a being is born on its natal LOCAL model, its anchor
//     AND permanent fallback. Here the operator layers an optional higher-
//     capacity override on top; "return to natal" clears it. If an override
//     provider is ever unreachable, resolution silently falls back to natal —
//     the being is never stranded off its home substrate.
//
// The two slash commands (/provider, /model) deep-link here via settings-focus
// (a latched CustomEvent), scrolling the matching block into view.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { getResidency } from '../../services/residency.js';
import { takeSettingsFocus, onSettingsFocus } from './settings-focus.js';
import { providerState, routeLabel, filterProviders } from './model-route-view.js';
import { ProviderKeyRemoval } from './ProviderKeyRemoval.jsx';
import { ProviderPicker } from './ProviderPicker.jsx';
import { ProviderOAuth } from './ProviderOAuth.jsx';
import { TrainingNotice } from './TrainingNotice.jsx';
import { EmptyState } from './empty-state.jsx';
import { Select } from './Select.jsx';
import { ModelPicker } from './ModelPicker.jsx';
import { RouteLanding } from './RouteLanding.jsx';
import {
  listProviders, listProviderModels, setProviderKey, testProvider,
  connectProvider, listConnections, removeConnection,
  getNeumaRoute, setNeumaRoute, clearNeumaRoute,
} from '../../services/routing.js';
import { useSettled } from './use-settled.js';
import { loadSubstrateModels } from './substrate-client.js';

export const ModelsSection = ({ focus: focusProp = null }) => {
  const { t } = useTranslation(['settingsModels', 'common']);
  const providersRef = useRef(null);
  const routeRef = useRef(null);
  // Deep-link target from a /provider or /model slash command: latched on mount
  // (the window mounts after the command fires), then live via the event.
  const [focus, setFocus] = useState(() => focusProp || takeSettingsFocus());
  useEffect(() => onSettingsFocus(setFocus), []);

  // ── Providers ──
  const [providers, setProviders] = useState([]);
  const [provError, setProvError] = useState(null);
  const [provQuery, setProvQuery] = useState(''); // catalog filter (161 entries)
  const [connections, setConnections] = useState([]); // locked — the summon pool
  const [sel, setSel] = useState(null);            // selected provider id (editor)
  const [keyInput, setKeyInput] = useState('');
  const [endpointInput, setEndpointInput] = useState('');
  const [connectModel, setConnectModel] = useState(''); // model the connection locks
  const [provBusy, setProvBusy] = useState(false);
  const [editError, setEditError] = useState(null);
  const [testResult, setTestResult] = useState(null); // { ok, text }

  // ── Per-being route ──
  const [beings, setBeings] = useState([]);
  const [beingId, setBeingId] = useState('');
  const [route, setRoute] = useState(null);
  const [routeError, setRouteError] = useState(null);
  const [ovProvider, setOvProvider] = useState('');
  const [ovModel, setOvModel] = useState('');
  const [models, setModels] = useState([]);
  const [routeBusy, setRouteBusy] = useState(false);

  const loadProviders = () =>
    Promise.all([listProviders(), listConnections()])
      .then(([r, c]) => {
        setProviders(r.providers);
        setConnections(Array.isArray(c.connections) ? c.connections : []);
        setProvError(null);
      })
      .catch((e) => setProvError(e.message));

  const loadBeings = () =>
    getResidency()
      .then((r) => {
        const list = Array.isArray(r.neuma) ? r.neuma : [];
        setBeings(list);
        setBeingId((cur) => cur || list[0]?.neumaId || '');
      })
      .catch((e) => setRouteError(e.message));

  useEffect(() => { loadProviders(); }, []);
  useEffect(() => { loadBeings(); }, []);

  // Deep-link scroll when a slash command opens Settings with a focus target.
  useEffect(() => {
    const el = focus === 'providers' ? providersRef.current
      : focus === 'route' ? routeRef.current : null;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);

  // Load the selected being's route whenever the being changes.
  useSettled((settled) => {
    if (!beingId) { setRoute(null); return; }
    setRouteError(null);
    getNeumaRoute(beingId)
      .then((v) => {
        if (settled()) return;
        setRoute(v);
        // Seed the override editor with the current effective choice.
        setOvProvider(v.override?.provider || v.effective?.provider || '');
        setOvModel(v.override?.model || '');
      })
      .catch((e) => { if (!settled()) setRouteError(e.message); });
  }, [beingId]);

  // Populate the model suggestions for whichever provider the override targets.
  useSettled((settled) => {
    if (!ovProvider) { setModels([]); return; }
    listProviderModels(ovProvider)
      .then((r) => { if (!settled()) setModels(r.models || []); })
      .catch(() => { if (!settled()) setModels([]); }); // suggestions are best-effort
  }, [ovProvider]);

  const selectProvider = (id) => {
    uiSound('open');
    setSel(id);
    setKeyInput('');
    const p = providers.find((x) => x.id === id);
    setEndpointInput(p?.endpoint || '');
    setConnectModel(p?.defaultModel || '');
    setEditError(null);
    setTestResult(null);
    // Prefer the actually loaded / last active substrate model for local providers (not the registry default).
    if (id === 'llama-server' || id === 'lm-studio' || id === 'ollama') {
      loadSubstrateModels().then((c) => {
        if (c && c.active) {
          const match = (c.models || []).find((m) => m.id === c.active || m.path === c.active);
          if (match) setConnectModel(match.id);
        }
      }).catch(() => {});
    }
  };

  const selectedProvider = providers.find((p) => p.id === sel) || null;
  // The selected provider's locked connection, if one holds — a locked
  // provider is LIVE (signal register), and new witnesses summon onto it.
  const locked = connections.find((c) => c.providerId === sel) || null;

  const runTest = async () => {
    uiSound('activate');
    setProvBusy(true); setEditError(null); setTestResult(null);
    try {
      const r = await testProvider(sel, {
        apiKey: keyInput || undefined,
        endpoint: endpointInput || undefined,
      });
      setTestResult(r.success
        ? { ok: true, text: t('providers.reachable', { count: (r.models || []).length }) }
        : { ok: false, text: r.error || t('providers.unreachable') });
    } catch (e) { setEditError(e.message); }
    setProvBusy(false);
  };

  const saveKey = async () => {
    uiSound('activate');
    setProvBusy(true); setEditError(null);
    try {
      await setProviderKey(sel, {
        apiKey: keyInput || undefined,
        endpoint: endpointInput || undefined,
      });
      setKeyInput('');
      await loadProviders();
    } catch (e) { setEditError(e.message); }
    setProvBusy(false);
  };

  // CONNECT proves the provider live, then locks the connection — the pool
  // new witnesses are summoned from (the WITNESSES desk). The verdict arrives
  // in-body (400s included), like the test endpoint.
  const runConnect = async () => {
    uiSound('activate');
    setProvBusy(true); setEditError(null);
    try {
      const r = await connectProvider(sel, {
        model: connectModel.trim() || undefined,
        endpoint: endpointInput || undefined,
        apiKey: keyInput || undefined,
      });
      if (!r.success) { setEditError(r.error || t('providers.couldNotConnect')); setProvBusy(false); return; }
      setKeyInput('');
      await loadProviders();
    } catch (e) { setEditError(e.message); }
    setProvBusy(false);
  };

  // UNLOCK drops the connection only — the stored credential is untouched.
  const unlock = async () => {
    uiSound('deny');
    setProvBusy(true); setEditError(null);
    try {
      await removeConnection(sel);
      await loadProviders();
    } catch (e) { setEditError(e.message); }
    setProvBusy(false);
  };

  const applyOverride = async () => {
    if (!beingId || !ovProvider || !ovModel.trim()) return;
    uiSound('activate');
    setRouteBusy(true); setRouteError(null);
    try {
      setRoute(await setNeumaRoute(beingId, { provider: ovProvider, model: ovModel.trim() }));
    } catch (e) { setRouteError(e.message); }
    setRouteBusy(false);
  };

  const returnToNatal = async () => {
    if (!beingId) return;
    uiSound('activate');
    setRouteBusy(true); setRouteError(null);
    try {
      const v = await clearNeumaRoute(beingId);
      setRoute(v);
      setOvProvider(v.effective?.provider || '');
      setOvModel('');
    } catch (e) { setRouteError(e.message); }
    setRouteBusy(false);
  };

  const natal = routeLabel(route?.natal);
  const override = routeLabel(route?.override);
  const eff = route?.effective;

  return (
    <>
      {/* ── PROVIDERS ──────────────────────────────────────────────── */}
      <section className="settings-sec" ref={providersRef}>
        <div className="label-data settings-h">{t('providers.heading')}</div>
        <p className="settings-note">{t('providers.note')}</p>

        {provError ? <p className="settings-err">{provError}</p> : null}

        {providers.length ? (
          <>
            <input
              className="settings-input settings-provider-filter"
              type="text"
              value={provQuery}
              onChange={(e) => setProvQuery(e.target.value)}
              placeholder={t('providers.filterPlaceholder', { count: providers.length })}
              spellCheck={false}
              autoComplete="off"
              aria-label={t('providers.filterAria')}
            />
            {filterProviders(providers, provQuery).length ? (
              <ul className="settings-files settings-provider-list">
                {filterProviders(providers, provQuery).map((p) => {
                  const s = providerState(p);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={`settings-provider-row${sel === p.id ? ' is-sel' : ''}`}
                        onClick={() => selectProvider(p.id)}
                        disabled={provBusy}
                        aria-pressed={sel === p.id}
                      >
                        <code>{p.name}</code>
                        <span className="settings-sec-tags">
                          <span className="settings-tag-dim">{p.kind === 'local' ? t('providers.kindLocal') : t('providers.kindCloud')}</span>
                          <span className={s.cls}>{s.tag}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title={t('providers.noMatch')} />
            )}
          </>
        ) : (
          !provError && <EmptyState title={t('providers.reading')} />
        )}

        {selectedProvider ? (
          <div className="settings-realm settings-provider-edit">
            <p className="settings-note">
              {selectedProvider.name}
              {selectedProvider.kind === 'local'
                ? selectedProvider.sovereign
                  ? t('providers.descSovereign')
                  : t('providers.descBridge')
                : selectedProvider.allowsApiKey === false
                  ? t('providers.descSignIn')
                  : selectedProvider.requiresKey
                  ? t('providers.descKey')
                  : t('providers.descEndpoint')}
              {selectedProvider.hasKey ? t('providers.keyStored') : ''}
            </p>
            <TrainingNotice provider={selectedProvider} />
            {selectedProvider.id === 'custom' || selectedProvider.kind === 'local' || !selectedProvider.requiresKey ? (
              <div className="settings-control">
                <input
                  className="settings-input"
                  type="text"
                  value={endpointInput}
                  onChange={(e) => setEndpointInput(e.target.value)}
                  placeholder="https://host:port  (base URL)"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={t('providers.endpointAria')}
                />
              </div>
            ) : null}
            {selectedProvider.kind !== 'local' && selectedProvider.allowsApiKey !== false ? (
              <div className="settings-control">
                <input
                  className="settings-input"
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={selectedProvider.hasKey ? t('providers.keyStoredPlaceholder') : t('providers.keyPlaceholder')}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={t('providers.keyAria')}
                />
              </div>
            ) : null}
            <ProviderOAuth provider={selectedProvider} onChanged={loadProviders} />
            <div className="settings-control settings-provider-actions">
              <button type="button" className="settings-set" onClick={runTest} disabled={provBusy}>
                {provBusy ? '…' : t('providers.test')}
              </button>
              {selectedProvider.allowsApiKey !== false ? (
                <button
                  type="button"
                  className="settings-set"
                  onClick={saveKey}
                  disabled={provBusy || (!keyInput && !endpointInput)}
                >
                  {t('providers.save')}
                </button>
              ) : null}
              {selectedProvider.hasKey && selectedProvider.allowsApiKey !== false ? (
                <ProviderKeyRemoval key={sel} provider={selectedProvider} busy={provBusy}
                  onBusy={setProvBusy} onError={setEditError} onChanged={loadProviders} />
              ) : null}
            </div>
            {locked ? (
              <div className="settings-control">
                <span className="settings-tag-ok provider-oauth-account label-data">
                  {t('providers.locked')} · {locked.model}{locked.account ? ` · ${locked.account}` : ''}
                </span>
                <button type="button" className="settings-set is-danger" onClick={unlock} disabled={provBusy}>
                  {t('providers.unlock')}
                </button>
              </div>
            ) : (
              <div className="settings-control">
                <input
                  className="settings-input"
                  type="text"
                  value={connectModel}
                  onChange={(e) => setConnectModel(e.target.value)}
                  placeholder={selectedProvider.defaultModel || t('providers.modelIdPlaceholder')}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={t('providers.connectModelAria')}
                />
                <button
                  type="button"
                  className="settings-set"
                  onClick={runConnect}
                  disabled={provBusy}
                  title={t('providers.connectTitle')}
                >
                  {provBusy ? '…' : t('providers.connect')}
                </button>
              </div>
            )}
            {testResult ? (
              <p className={testResult.ok ? 'settings-note' : 'settings-warn'}>
                {selectedProvider.id}: {testResult.text}
              </p>
            ) : null}
            {editError ? <p className="settings-err">{editError}</p> : null}
          </div>
        ) : null}
      </section>

      {/* ── MODEL (per being) ──────────────────────────────────────── */}
      <section className="settings-sec" ref={routeRef}>
        <div className="label-data settings-h">{t('route.heading')}</div>
        <p className="settings-note">{t('route.note')}</p>

        {routeError ? <p className="settings-err">{routeError}</p> : null}

        {beings.length ? (
          <div className="settings-control">
            <Select
              fill
              ariaLabel={t('route.beingAria')}
              value={beingId}
              onChange={setBeingId}
              options={beings.map((b) => ({ value: b.neumaId, label: b.name }))}
            />
          </div>
        ) : (
          !routeError && <EmptyState title={t('route.noBeings')} />
        )}

        {route ? (
          <div className="settings-realm">
            <div className="settings-row">
              <span className="settings-k">{t('route.natalKey')}</span>
              <code className="settings-v">{natal || '—'}</code>
            </div>
            <div className="settings-row">
              <span className="settings-k">{t('route.overrideKey')}</span>
              <span className="settings-v">
                {override ? <code>{override}</code> : <span className="settings-tag-dim">{t('route.noneOnNatal')}</span>}
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-k">{t('route.effectiveKey')}</span>
              <span className="settings-v">
                <code>{routeLabel(eff) || '—'}</code>
                {eff?.fellBack ? (
                  <span className="settings-tag-warn"> {t('route.fellBack')} {eff.reason || t('route.fellBackDefault')}</span>
                ) : null}
              </span>
            </div>
            <RouteLanding landing={route.landing} />
          </div>
        ) : null}

        {beingId ? (
          <>
            <p className="settings-note">{t('route.overrideNote')}</p>
            <div className="settings-control">
              <ProviderPicker
                providers={providers.filter((p) => p.sovereign)}
                ariaLabel={t('route.providerAria')}
                value={ovProvider}
                onChange={(v) => { setOvProvider(v); setOvModel(''); }}
              />
              <ModelPicker
                models={models}
                value={ovModel}
                onChange={setOvModel}
                ariaLabel={t('route.modelAria')}
              />
              <button
                type="button"
                className="settings-set"
                onClick={applyOverride}
                disabled={routeBusy || !ovProvider || !ovModel.trim()}
              >
                {t('common:set')}
              </button>
            </div>
            {override ? (
              <div className="settings-control">
                <button type="button" className="settings-set" onClick={returnToNatal} disabled={routeBusy}>
                  {t('route.returnToNatal')}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </>
  );
};
