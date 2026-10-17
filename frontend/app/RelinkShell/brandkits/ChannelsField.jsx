// ChannelsField — where this brand speaks from, one channel at a time.
//
// `channels` is gated as an `object` — satisfied by any non-empty one — and
// carried in the two shipped kits as `{x: {handle: '@umbrae_ignis'}, site:
// {handle: 'umbrae.io'}}`. Until now the only way to write that was to type the
// JSON, nested braces and all, into the raw textarea.
//
// The rows edit `channels.<name>.handle` and leave any other key on a channel
// untouched — a kit that has grown a `channels.x.listId` from somewhere else
// must not lose it because somebody corrected a handle here.

import { useState } from 'react';
import { FieldLabel } from './FieldControls.jsx';

/** A channel name reaches a JSON key and a template's {{brand.*}} lookups, so
 *  it is held to the same plain shape every other name in this lane is. */
const CHANNEL = /^[a-z][a-z0-9-]*$/;

export const ChannelsField = ({ field, value, onChange, gap }) => {
  const [typed, setTyped] = useState('');
  const channels = value && typeof value === 'object' ? value : {};
  const names = Object.keys(channels);

  const put = (name, handle) =>
    onChange(field.path, { ...channels, [name]: { ...(channels[name] || {}), handle } });

  const add = () => {
    const name = typed.trim().toLowerCase();
    if (!CHANNEL.test(name) || channels[name]) return;
    put(name, '');
    setTyped('');
  };

  return (
    <div className="bk-field bk-field-wide">
      <FieldLabel field={field} gap={gap} />
      {names.length === 0 ? <p className="bk-list-none label-data">NO CHANNELS YET</p> : null}
      <ul className="bk-chan">
        {names.map((name) => (
          <li key={name}>
            <span className="label-data">{name}</span>
            <input
              type="text"
              value={channels[name]?.handle || ''}
              placeholder="@handle, or a domain"
              spellCheck="false"
              onChange={(e) => put(name, e.target.value)}
            />
            <button
              type="button"
              className="bk-list-del"
              aria-label={`remove ${name}`}
              onClick={() => {
                const next = { ...channels };
                delete next[name];
                onChange(field.path, next);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <span className="bk-list-add">
        <input
          type="text"
          value={typed}
          placeholder="a channel — x, site, farcaster"
          spellCheck="false"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button type="button" onClick={add} disabled={!CHANNEL.test(typed.trim().toLowerCase())}>ADD</button>
      </span>
    </div>
  );
};
