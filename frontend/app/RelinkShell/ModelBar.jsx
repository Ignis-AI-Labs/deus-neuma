// ModelBar — WHICH MIND is answering, and how hard it thinks.
//
// One control for stream and SUBSTRATE: same catalog, same loaded row, same
// effort. `catalog="substrate"` reads the rig view (what's on the GPU);
// default reads the being's models (ignite catalog or a witness's provider).
// Picking a row IGNITES those weights or moves the being's route — the server
// names which; a harness lane adds its SERVER (switchBy 'harness'). Effort is
// the focused being's stored choice.

import { memo, useCallback, useEffect, useState } from 'react';
import { Select } from './Select.jsx';
import { setBeingEffort } from '../../services/inference.js';
import { setNeumaRoute } from '../../services/routing.js';
import { igniteSubstrate, unloadSubstrate } from './substrate-client.js';
import { IgniteSwitchAsk } from './IgniteSwitchAsk.jsx';
import { modelBarState } from './model-bar-view.js';
import { useSubstrateBoot } from './use-substrate-boot.js';
import { useModelBarData } from './use-model-bar-data.js';
import { ModelBarReadStatus } from './ModelBarReadStatus.jsx';
import { HarnessServerPick, switchHarnessTo } from './HarnessServerPick.jsx';
import { announceSubstrateChange, onSubstrateChange } from './substrate-change.js';
import { uiSound } from '../../services/ui-sound.js';
import { asText } from '../../utils/as-text.js';

const ModelBarView = ({
  beingId,
  catalog = 'being',
  showUnload = false,
  serving = false,
  acting = false,
  act = null,
  trailing = null,
}) => {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  // IGNITE's question when the house runs on another provider (IgniteSwitchAsk.jsx)
  const [ask, setAsk] = useState(null);
  const [epoch, setEpoch] = useState(0);
  const { modelRead, effortRead, setEffort } = useModelBarData({ beingId, catalog, epoch, serving });
  const models = modelRead.data;
  const effort = effortRead.data;

  const reread = useCallback(() => setEpoch((n) => n + 1), []);
  const witnessCatalog = catalog === 'being' && beingId?.startsWith('witness-');
  const { bootSeconds, watch } = useSubstrateBoot({
    onFailed: (why) => setRefusal(`IGNITION FAILED — ${why}`),
    onServing: reread,
  });
  const surface = catalog === 'substrate' ? 'substrate' : 'stream';
  const locked = busy || acting || bootSeconds !== null;

  useEffect(() => onSubstrateChange(({ kind }) => {
    if (kind !== 'igniting') reread();
  }), [reread]);

  const bar = modelBarState({ beingId, models, effort, surface });
  if (!bar.show) return null;

  const run = async (fn) => {
    const body = async () => {
      setRefusal(null);
      setAsk(null);
      try {
        const result = await fn();
        if (result?.ask) setAsk(result.ask);
        else if (result && result.ok === false) setRefusal(asText(result.error) || 'The act did not land.');
        else if (result?.status === 'igniting') {
          announceSubstrateChange('igniting');
          watch();
        } else {
          announceSubstrateChange('change');
          reread();
        }
      } catch (err) {
        setRefusal(err?.message || 'The act did not land.');
      }
    };
    if (act) return act(body);
    if (busy) return undefined;
    setBusy(true);
    try { await body(); } finally { setBusy(false); }
    return undefined;
  };

  const pickModel = async (modelId) => {
    if (!modelId || modelId === bar.model.value || locked) return;
    uiSound('activate');
    if (bar.model.switchBy === 'ignite') {
      await run(() => igniteSubstrate(modelId));
      return;
    }
    if (bar.model.switchBy === 'harness') {
      await run(async () => { await switchHarnessTo({ ...models.server, model: modelId }); return { ok: true }; });
      return;
    }
    await run(async () => {
      await setNeumaRoute(beingId, { provider: effort?.route?.provider || models?.route?.provider, model: modelId });
      return { ok: true };
    });
  };

  const choose = async (next) => {
    if (locked || !beingId) return;
    uiSound('tick');
    await run(async () => {
      setEffort(await setBeingEffort(beingId, next));
      return { ok: true };
    });
  };

  return (
    <div className={`relink-modelbar${surface === 'substrate' ? ' is-rig' : ''}`} role="group" aria-label="Model and effort">
      {/* A harness talks to ONE server, named here beside its model (HarnessServerPick). */}
      {bar.model.switchBy === 'harness' && models?.server ? (
        <HarnessServerPick server={models.server} locked={locked} run={run} />
      ) : null}
      {bar.model.options.length > 0 ? (
        <Select
          className="relink-modelbar-model"
          ariaLabel="Model"
          value={bar.model.value}
          placeholder={bar.model.placeholder}
          options={bar.model.options}
          disabled={locked || modelRead.pending || Boolean(modelRead.error)}
          onChange={pickModel}
          onOpen={witnessCatalog ? reread : undefined}
        />
      ) : null}
      {bar.effort.options.length > 0 ? (
        <Select
          className="relink-modelbar-effort"
          ariaLabel="Effort"
          value={bar.effort.value}
          placeholder="effort"
          options={bar.effort.options}
          disabled={locked || effortRead.pending || Boolean(effortRead.error) || !bar.thinking.on}
          onChange={(rung) => choose({ effort: rung, thinking: bar.thinking.on })}
        />
      ) : (beingId && effort && !effortRead.pending && !effortRead.error ? (
        <span className="relink-modelbar-note label-data" title={bar.effort.note}>NO EFFORT TIERS</span>
      ) : null)}
      {bar.thinking.show ? (
        <button
          type="button"
          className={`relink-modelbar-think${bar.thinking.on ? ' is-on' : ''}`}
          aria-pressed={bar.thinking.on}
          disabled={locked || effortRead.pending || Boolean(effortRead.error)}
          title={bar.thinking.on
            ? `${bar.thinking.label} — this model reasons before it answers; click to have it answer straight`
            : `${bar.thinking.label} is off — this model answers without reasoning first`}
          onClick={() => choose({ effort: bar.effort.value || undefined, thinking: !bar.thinking.on })}
        >
          {bar.thinking.label}
        </button>
      ) : null}
      {showUnload && bootSeconds === null && serving ? (
        <button type="button" className="sub-btn" disabled={locked} onClick={() => run(unloadSubstrate)}>
          {locked ? '…' : 'UNLOAD'}
        </button>
      ) : null}
      {showUnload && bootSeconds === null && !serving ? (
        <button type="button" className="sub-btn is-primary" disabled={locked || modelRead.pending || Boolean(modelRead.error)}
          onClick={() => run(() => igniteSubstrate(bar.model.value || null))}>
          {locked ? 'IGNITING…' : 'IGNITE'}
        </button>
      ) : null}
      {bootSeconds !== null ? (
        <span className="relink-modelbar-boot label-data" role="status">IGNITING… {bootSeconds}s</span>
      ) : null}
      <ModelBarReadStatus modelRead={modelRead} effortRead={effortRead} beingId={beingId}
        locked={locked} onRetry={reread} />
      {refusal ? <span className="relink-modelbar-refusal label-data" role="status">{refusal}</span> : null}
      {ask ? (
        <IgniteSwitchAsk ask={ask} locked={locked} onCancel={() => setAsk(null)}
          onConfirm={() => run(() => igniteSubstrate(ask.model, { confirmSwitch: true }))} />
      ) : null}
      {witnessCatalog && models?.catalogSource === 'fallback' ? (
        <span className="relink-modelbar-note label-data" role="status">MODEL LIST UNVERIFIED</span>
      ) : null}
      {/* The caller's trailing slot — the house activity chip rides here, at
          the row's right end (Design note, 2026-09-15. */}
      {trailing}
    </div>
  );
};

// Memoized: the composer re-renders on every keystroke; this does not need to
// (2026-09-28 smoothness pass).
export const ModelBar = memo(ModelBarView);
