// StandingPanel — a platform's standing in the console head's register: three
// compact cells, KEYS · HOLDER · CREW, each a drawn state (signal = ready,
// alert = posting blocked by it, ink = settled) with the one act it asks for.
// ONE component for every platform window (PlatformSpace renders it), so X,
// Telegram, Discord, Facebook, Mastodon, Bluesky, LinkedIn, YouTube and every
// platform after them stand the same way.
//
// The holder follows the house's marketing seat (platform-standing.js): the
// CMO by default, "change" offers only the marketing-seated, and with no CMO
// the cell says so and points to where the seat is given.

import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { Select } from './Select.jsx';
import { useWindows } from '../windowing/use-windows.js';
import { requestSettingsFocus } from './settings-focus.js';
import { keysStanding } from './platform-standing.js';
import './PlatformStanding.css';

/** One fact of the standing: its state drawn on the edge, its value, its act. */
const Cell = ({ k, tone, value, sub, children }) => (
  <div className={`ps-cell is-${tone}`} role="group" aria-label={k} data-tone={tone}>
    <span className="ps-cell-k">{k}</span>
    <span className="ps-cell-v">{value}</span>
    {sub ? <span className="ps-cell-sub">{sub}</span> : null}
    {children ? <span className="ps-cell-act">{children}</span> : null}
  </div>
);

const Act = ({ children, onClick, link = false, disabled = false, pressed }) => (
  <button type="button" className={link ? 'ps-link' : 'ps-btn'} onClick={onClick} disabled={disabled} aria-pressed={pressed}>
    {children}
  </button>
);

const KEYS_WORD = { unset: 'Not connected', failing: 'Refused', set: 'Connected', proven: 'Connected' };

const KeysCell = ({ channel, test, onManage }) => {
  const keys = keysStanding(channel, test);
  const value = keys.account ? `${KEYS_WORD[keys.state]} · ${keys.account}` : KEYS_WORD[keys.state];
  const sub = keys.state === 'failing' ? (test?.detail || 'the platform refused the keys')
    : keys.state === 'set' ? 'not yet proven live' : null;
  return (
    <Cell k="KEYS" tone={keys.blocked ? 'blocked' : 'ready'} value={value} sub={sub}>
      {keys.blocked ? <Act onClick={onManage}>MANAGE KEYS</Act> : null}
    </Cell>
  );
};

const HolderCell = ({ holder, open, onChange, onSeat }) => {
  const change = holder.offered.length > 0
    ? <Act link onClick={onChange} pressed={open}>{open ? 'close' : 'change'}</Act> : null;
  if (holder.state === 'held') {
    const h = holder.holder;
    const seat = h.seat ?? 'no marketing seat';
    return (
      <Cell k="HOLDER" tone="ready" value={h.name} sub={h.witness ? `${seat} · WITNESS` : seat}>
        {change}
      </Cell>
    );
  }
  if (holder.state === 'no-seat') {
    return (
      <Cell k="HOLDER" tone="blocked" value="No one holds the marketing seat yet">
        <Act onClick={onSeat}>SEAT A CMO</Act>{change}
      </Cell>
    );
  }
  const sub = {
    auto: 'binding — the CMO takes it',
    'awaiting-keys': 'CMO · holds it once the keys are set',
    released: 'CMO · released here — no one may post',
  }[holder.state];
  return (
    <Cell k="HOLDER" tone={holder.state === 'released' ? 'blocked' : 'idle'} value={holder.cmo.name} sub={sub}>{change}</Cell>
  );
};

/** The holder's choices: only the marketing-seated, then release. */
const HolderChooser = ({ holder, busy, onBind, onRelease }) => (
  <div className="ps-drawer" role="group" aria-label="choose the holder">
    <span className="ps-drawer-k">MARKETING SEATS — only these may hold it</span>
    <div className="ps-choices">
      {holder.offered.map((c) => {
        const on = holder.holder?.neumaId === c.neumaId;
        return (
          <button key={c.neumaId} type="button" className={`ps-choice${on ? ' is-on' : ''}`} aria-pressed={on}
            disabled={busy || on} onClick={() => onBind(c.neumaId)}>
            <b>{c.name}</b><span>{c.witness ? `${c.seat} · WITNESS` : c.seat}</span>
          </button>
        );
      })}
      {holder.holder ? (
        <button type="button" className="ps-choice is-release" disabled={busy} onClick={onRelease}>
          <b>Release</b><span>no one may post</span>
        </button>
      ) : null}
    </div>
  </div>
);

/** The crew: who works this platform beside its holder. */
const CrewDrawer = ({ channel, roster, crew, busy, onAdd, onRemove }) => {
  const [pick, setPick] = useState('');
  const [remit, setRemit] = useState('');
  const memberOf = (id) => roster.find((m) => m.neumaId === id) || null;
  const seated = new Set(crew.map((m) => m.neumaId));
  const available = roster.filter((m) => !seated.has(m.neumaId));
  return (
    <div className="ps-drawer" role="group" aria-label="the crew">
      <span className="ps-drawer-k">CREW — draft and stage; only the holder&rsquo;s keys reach {channel.name}</span>
      {crew.length ? (
        <ul className="ps-crew">
          {crew.map((m) => (
            <li key={m.neumaId}>
              <b>{memberOf(m.neumaId)?.name || m.neumaId}</b>
              <span>{m.kind === 'witness' ? 'WITNESS' : 'NEUMA'}{m.remit ? ` · ${m.remit}` : ''}</span>
              <Act link disabled={busy} onClick={() => onRemove(m.neumaId)}>release</Act>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ps-crew-add">
        <Select fill ariaLabel={`Add to the ${channel.name} crew`} value={pick} onChange={setPick}
          disabled={busy || available.length === 0}
          placeholder={available.length === 0 ? '— everyone available is seated —' : '— add a neuma or witness —'}
          options={available.map((m) => ({ value: m.neumaId, label: `${m.name || m.neumaId}${m.participantKind === 'witness' ? ' · witness' : ''}` }))} />
        <input className="settings-input" placeholder="What they hold here (optional)" value={remit}
          onChange={(e) => setRemit(e.target.value)} disabled={busy || !pick} />
        <Act disabled={busy || !pick} onClick={async () => {
          await onAdd({ neumaId: pick, kind: memberOf(pick)?.participantKind === 'witness' ? 'witness' : 'neuma', remit });
          setPick('');
          setRemit('');
        }}>ADD</Act>
      </div>
    </div>
  );
};

/**
 * The announcement that the window bound the platform by itself — said
 * plainly, with the way to change it and the way to put it away.
 * @param {{notice: {name: string, seat: string}, channelName: string, onChange: () => void, onDismiss: () => void}} props
 */
export const StandingNotice = ({ notice, channelName, onChange, onDismiss }) => (
  <p className="ps-notice" role="status">
    <span className="ps-notice-tag">«NOTICE»</span>
    <span><b>{notice.name}</b> now holds {channelName} — bound automatically, because {notice.name} holds
      the {notice.seat} seat and the keys are set.</span>
    <Act link onClick={onChange}>change</Act>
    <Act link onClick={onDismiss}>dismiss</Act>
  </p>
);

/**
 * @param {{standing: ReturnType<typeof import('./use-platform-standing.js').usePlatformStanding>,
 *   test: ?object, drawer: ?string, onDrawer: (d: ?string) => void}} props
 */
export const StandingPanel = ({ standing, test, drawer, onDrawer }) => {
  const { dispatch } = useWindows();
  const { channel, roster, crew, holder, busy, error } = standing;
  const toggle = (d) => { uiSound('toggle'); onDrawer(drawer === d ? null : d); };
  const open = (id) => { uiSound('toggle'); dispatch({ type: 'OPEN', id }); };
  const pressed = (fn) => (...args) => { uiSound('toggle'); return fn(...args); };
  return (
    <section className="ps" aria-label={`${channel.name} standing`}>
      <div className="ps-cells">
        <KeysCell channel={channel} test={test} onManage={() => { open('settings'); requestSettingsFocus('channel-keys'); }} />
        {holder
          ? <HolderCell holder={holder} open={drawer === 'holder'} onChange={() => toggle('holder')} onSeat={() => open('marketing')} />
          : <Cell k="HOLDER" tone="idle" value="—" sub="reading the house" />}
        <Cell k="CREW" tone={crew.length ? 'ready' : 'idle'} value={crew.length}
          sub={crew.length ? crew.map((m) => roster.find((r) => r.neumaId === m.neumaId)?.name || m.neumaId).join(' · ') : 'no one works it yet'}>
          <Act onClick={() => toggle('crew')} pressed={drawer === 'crew'}>{drawer === 'crew' ? 'CLOSE' : 'MANAGE CREW'}</Act>
        </Cell>
      </div>
      {drawer === 'holder' && holder?.offered.length
        ? <HolderChooser holder={holder} busy={busy} onBind={pressed(standing.bind)} onRelease={pressed(standing.release)} /> : null}
      {drawer === 'crew'
        ? <CrewDrawer channel={channel} roster={roster} crew={crew} busy={busy} onAdd={pressed(standing.addCrew)} onRemove={pressed(standing.removeCrew)} /> : null}
      {error ? <p className="settings-err">{error}</p> : null}
    </section>
  );
};
