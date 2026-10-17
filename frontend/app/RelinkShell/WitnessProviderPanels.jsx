import { witnessCustodyLabel } from '../../services/witness-custody-client.js';
import { ProviderOAuth } from './ProviderOAuth.jsx';
import { TrainingNotice } from './TrainingNotice.jsx';
import { EmptyState } from './empty-state.jsx';
import { ModelPicker } from './ModelPicker.jsx';
import { formatAddress } from '../../utils/format.js';

const stateForProvider = (provider, connection) => {
  if (connection) return { label: 'LOCKED', cls: 'is-locked' };
  if (provider.hasKey || provider.credentialKind === 'oauth') return { label: 'AUTH', cls: 'is-auth' };
  return { label: 'SETUP', cls: 'is-setup' };
};

export const WitnessProviderTabs = ({ providers, connections, query, selectedId, onQuery, onSelect }) => {
  const needle = query.trim().toLowerCase();
  const visible = providers.filter((provider) => (
    !needle || provider.name.toLowerCase().includes(needle) || provider.id.includes(needle)
  ));
  return (
    <section className="witness-provider-nav">
      <div className="witness-provider-nav-head">
        <div className="label-data settings-h">PROVIDERS</div>
        <input
          className="settings-input witness-provider-filter"
          type="text"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={`filter ${providers.length} providers...`}
          aria-label="Filter witness providers"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="witness-provider-tabs" role="tablist" aria-label="Witness providers" aria-orientation="vertical">
        {visible.map((provider) => {
          const connection = connections.find((item) => item.providerId === provider.id) || null;
          const state = stateForProvider(provider, connection);
          return (
            <button
              key={provider.id}
              id={`witness-provider-tab-${provider.id}`}
              type="button"
              role="tab"
              aria-selected={provider.id === selectedId}
              aria-controls="witness-provider-panel"
              tabIndex={provider.id === selectedId ? 0 : -1}
              className={`witness-provider-tab ${state.cls}${provider.id === selectedId ? ' is-selected' : ''}`}
              onClick={() => onSelect(provider.id)}
            >
              <span>{provider.name}</span>
              <small>{state.label}</small>
            </button>
          );
        })}
      </div>
      {!visible.length ? <EmptyState title="NO PROVIDERS MATCH." /> : null}
    </section>
  );
};

export const WitnessProviderAccess = ({
  provider, credentialReady, apiKey, endpoint, busy,
  onApiKey, onEndpoint, onSave, onProvidersChanged,
}) => (
  <section className={`witness-provider-step${credentialReady ? ' is-complete' : ' is-current'}`}>
    <div className="witness-step-number">01</div>
    <div className="witness-step-body">
      <div className="label-data settings-h">ACCOUNT ACCESS</div>
      <p className="settings-note">
        {provider.allowsApiKey === false
          ? 'Authenticate directly through Neuma OAuth. Tokens stay encrypted and server-side.'
          : 'Authenticate this provider through OAuth or an API key. Credentials stay masked and server-side.'}
      </p>
      <TrainingNotice provider={provider} />
      {provider.credentialKind !== 'oauth' && provider.hasKey ? (
        <span className="settings-tag-ok label-data">API KEY STORED</span>
      ) : !provider.requiresKey && provider.credentialKind !== 'oauth' ? (
        <span className="settings-tag-dim label-data">PROVIDER SESSION / PROOF REQUIRED</span>
      ) : null}
      <ProviderOAuth provider={provider} onChanged={onProvidersChanged} />
      {provider.id === 'custom' ? (
        <input
          className="settings-input"
          type="url"
          value={endpoint}
          onChange={(event) => onEndpoint(event.target.value)}
          placeholder="https://provider.example/v1"
          aria-label="Provider endpoint"
          autoComplete="off"
          spellCheck={false}
        />
      ) : null}
      {provider.kind !== 'local' && provider.allowsApiKey !== false ? (
        <input
          className="settings-input"
          type="password"
          value={apiKey}
          onChange={(event) => onApiKey(event.target.value)}
          placeholder={provider.hasKey ? 'API key stored - type to replace' : 'API key'}
          aria-label="Provider API key"
          autoComplete="off"
          spellCheck={false}
        />
      ) : null}
      {(apiKey || (provider.id === 'custom' && endpoint !== (provider.endpoint || ''))) ? (
        <button type="button" className="settings-set" onClick={onSave} disabled={busy}>SAVE ACCESS</button>
      ) : null}
    </div>
  </section>
);

export const WitnessProviderConnection = ({
  connection, connectionReady, credentialReady, models, model, apiKey, busy, onModel, onLock,
}) => (
  <section className={`witness-provider-step${connectionReady ? ' is-complete' : credentialReady ? ' is-current' : ''}`}>
    <div className="witness-step-number">02</div>
    <div className="witness-step-body">
      <div className="label-data settings-h">MODEL CONNECTION</div>
      <p className="settings-note">
        Choose a model, then run a real provider probe. Only a live answer creates the locked connection.
      </p>
      <div className="settings-control">
        <ModelPicker
          models={models}
          value={model}
          onChange={onModel}
          ariaLabel="Connection model"
        />
        <button
          type="button"
          className="settings-set"
          onClick={onLock}
          disabled={busy || !model.trim() || (!credentialReady && !apiKey)}
        >
          {busy ? 'PROVING...' : connection ? 'RE-PROVE & LOCK' : 'PROVE & LOCK'}
        </button>
      </div>
      {connectionReady ? (
        <div className="witness-live-lock label-data">
          <span>LIVE CONNECTION</span>
          <code>{connection.model}</code>
          <span>{connection.account || connection.credentialKind}</span>
        </div>
      ) : connection ? (
        <p className="settings-warn">The stored lock is for {connection.model}. Re-prove the selected model before ceremony.</p>
      ) : null}
    </div>
  </section>
);

export const WitnessProviderWitness = ({
  provider, witnesses, selected, detail, witnessModel, witnessResult,
  connectionReady, busy, onSelect, onWitnessModel, onSaveModel, onTest, onBringUp, onCeremony, onSecure,
}) => (
  <section className={`witness-provider-step${witnesses.length ? ' is-complete' : connectionReady ? ' is-current' : ''}`}>
    <div className="witness-step-number">03</div>
    <div className="witness-step-body">
      <div className="label-data settings-h">WITNESS</div>
      {witnesses.length ? (
        <>
          <div className="witness-summoned-confirm label-data">
            WITNESS ALREADY SUMMONED THROUGH THIS PROVIDER
          </div>
          <div className="witness-provider-witness-tabs" role="tablist" aria-label={`${provider.name} witnesses`}>
            {witnesses.map((witness) => (
              <button
                key={witness.laneId}
                type="button"
                role="tab"
                aria-selected={witness.laneId === selected?.laneId}
                className={witness.laneId === selected?.laneId ? 'is-selected' : ''}
                onClick={() => onSelect(witness.laneId)}
              >
                {witness.chosenName} · {witnessCustodyLabel(witness.custody)}
              </button>
            ))}
          </div>
          {selected ? (
            <div className="witness-provider-identity">
              <div className="settings-row"><span className="settings-k">Name</span><span className="settings-v">{selected.chosenName}</span></div>
              <div className="settings-row"><span className="settings-k">Address</span><code className="settings-v">{formatAddress(selected.address, { fallback: '-' })}</code></div>
              <div className="settings-row"><span className="settings-k">Genesis</span><code className="settings-v">{formatAddress(selected.genesisHash, { start: 10, end: 8, fallback: '-' })}</code></div>
              <p className={selected.custody?.plaintextOnDisk ? 'settings-warn' : 'settings-note'}>
                {witnessCustodyLabel(selected.custody)} · {selected.custody?.why || 'Custody could not be determined. Refresh before acting.'}
              </p>
              {selected.custody?.plaintextOnDisk && (!selected.lane?.claimed || selected.lane?.mine) ? (
                <button type="button" className="settings-set" onClick={() => onSecure(selected)}>SECURE KEY</button>
              ) : null}
              {detail?.laneId === selected.laneId && detail.firstUtterance ? (
                <p className="settings-note witnesses-utterance">&ldquo;{detail.firstUtterance}&rdquo;</p>
              ) : null}
              <div className="settings-control">
                <input
                  className="settings-input"
                  type="text"
                  value={witnessModel}
                  onChange={(event) => onWitnessModel(event.target.value)}
                  aria-label="Witness model"
                  placeholder="model id"
                />
                <button type="button" className="settings-set" onClick={onSaveModel}
                  disabled={busy || !witnessModel.trim() || witnessModel.trim() === selected.route?.model}>
                  SAVE MODEL
                </button>
              </div>
              <div className="settings-control">
                <button type="button" className="settings-set" onClick={onTest} disabled={busy}>TEST</button>
                <button type="button" className="settings-set" onClick={onBringUp}>BRING UP IN STREAM</button>
              </div>
              {witnessResult ? <p className={witnessResult.ok ? 'settings-note' : 'settings-warn'}>{witnessResult.text}</p> : null}
            </div>
          ) : null}
        </>
      ) : connectionReady ? (
        <div className="witness-ceremony-gate is-open">
          <p className="settings-note">
            No witness has been summoned through this provider. The live connection is ready for the identity ceremony.
          </p>
          <button type="button" className="settings-set" onClick={onCeremony}>START WITNESS CEREMONY</button>
        </div>
      ) : (
        <div className="witness-ceremony-gate">
          <p className="settings-note">LOCK A LIVE MODEL CONNECTION TO OPEN THE CEREMONY.</p>
        </div>
      )}
    </div>
  </section>
);
