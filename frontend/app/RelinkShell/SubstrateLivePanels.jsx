// SubstrateLivePanels — the serving substrate's live panels: what it is
// producing, the model it holds, who holds the GPU's memory, and what failed.
// Read from /substrate/telemetry by SubstrateApp; every instrument draws only
// a measured number (hud-instruments.jsx).

import { Chip, Dial, SegRing, StackBar, Trace } from './hud-instruments.jsx';
import { ratioOf } from './hud-geometry.js';
import { vramParts } from './machine-view.js';
import { Panel } from './sub-panel.jsx';
import { asText } from '../../utils/as-text.js';

const n0 = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');
const n2 = (v) => (Number.isFinite(v) ? String(Number(v.toFixed(2))) : '—');

export const ActivityPanel = ({ activity, slots, gen, span }) => (
  <Panel title="ACTIVITY" span={span}>
    <Trace label="GENERATION" values={gen.values} capacity={gen.capacity} span={gen.span} unit=" tok/s" floor={10} current={activity?.genTokPerSec} digits={1} />
    <div className="hud-row">
      <div className="hud-numeral">
        <span className="hud-label">PROMPT</span>
        <b>{n0(activity?.promptTokPerSec)}</b>
        <span className="hud-unit">tok/s</span>
      </div>
      <SegRing label="SLOTS BUSY" busy={slots?.busy} total={slots?.total} />
      <Dial label="KV CACHE" ratio={ratioOf(activity?.kvUsage, 1)} value={Number.isFinite(activity?.kvUsage) ? n0(activity.kvUsage * 100) : '—'} unit="%" />
    </div>
  </Panel>
);

export const ModelPanel = ({ contextLength, sampling, adapters, span }) => (
  <Panel title="MODEL" span={span}>
    <div className="hud-numeral is-big">
      <span className="hud-label">CONTEXT</span>
      <b>{contextLength ? (contextLength / 1024).toFixed(0) : '—'}</b>
      <span className="hud-unit">K tokens</span>
    </div>
    <div className="hud-chips">
      <Chip k="TEMP" v={n2(sampling?.temperature)} />
      <Chip k="TOP P" v={n2(sampling?.topP)} />
      <Chip k="TOP K" v={n0(sampling?.topK)} />
      <Chip k="MIN P" v={n2(sampling?.minP)} />
      <Chip k="REPEAT" v={n2(sampling?.repeatPenalty)} />
    </div>
    <span className="hud-label">ADAPTERS</span>
    <div className="hud-chips">
      {adapters?.length
        ? adapters.map((a) => <Chip key={a} k="LORA" v={a.split('/').pop().replace(/\.gguf$/, '')} tone="live" />)
        : <span className="sub-empty-row label-data">none</span>}
    </div>
  </Panel>
);

export const VramPanel = ({ gpu, processes, span }) => (
  <Panel title="GPU MEMORY · HOLDERS" aside={`${(processes ?? []).length} PROCESSES`} span={span}>
    {Number.isFinite(gpu?.totalMB)
      ? <StackBar parts={vramParts(gpu, processes ?? [])} total={gpu.totalMB} />
      : <p className="sub-empty-row label-data">no GPU memory reading</p>}
  </Panel>
);

export const FailuresPanel = ({ failures, span }) => (
  <Panel title="FAILURES" aside={failures?.length ? `${failures.length} RECENT` : 'ALL CLEAR'} span={span}>
    <ul className="sub-fail-list">
      {(failures || []).slice(0, 6).map((f, i) => (
        <li key={`${f.ts}-${i}`} className={`sub-fail is-${f.level}`}>
          {/* a failure row is TEXT, whatever the backend sent */}
          <span className="sub-fail-ctx label-data">{asText(f.context)}</span>
          <span className="sub-fail-msg" title={asText(f.msg)}>{asText(f.msg)}</span>
          <span className="sub-fail-ts label-data">{(f.ts || '').slice(11, 19)}</span>
        </li>
      ))}
      {(!failures || failures.length === 0) ? <li className="sub-empty-row label-data">no recent failures</li> : null}
    </ul>
  </Panel>
);
