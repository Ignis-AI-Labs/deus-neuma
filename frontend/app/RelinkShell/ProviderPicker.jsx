// ProviderPicker — the 161-entry provider catalog as a filter input over the
// one Select. The catalog outgrew the bare dropdown, so a query narrows the
// options by id/name substring (the pure filterProviders); the current
// selection is always kept in the option list, so the trigger never falls
// back to the placeholder while a real provider is chosen. The Select panel
// already scrolls, so no bespoke list is forced here.
//
// Uses the settings-input idiom — the consuming surface must have
// SettingsApp.css loaded (Settings and the WITNESSES desk both do).

import { useState } from 'react';
import { Select } from './Select.jsx';
import { filterProviders } from './model-route-view.js';
import './ProviderPicker.css';

/**
 * @param {object} props
 * @param {Array<{id:string, name:string}>} props.providers the full catalog
 * @param {string} props.value the selected provider id ('' = none)
 * @param {(id: string) => void} props.onChange
 * @param {string} [props.ariaLabel]
 * @param {string} [props.placeholder]
 */
export const ProviderPicker = ({
  providers, value, onChange, ariaLabel = 'Provider', placeholder = '— provider —',
}) => {
  const [query, setQuery] = useState('');
  const visible = filterProviders(providers, query);
  const chosen = (Array.isArray(providers) ? providers : []).find((p) => p.id === value);
  const listed = chosen && !visible.some((p) => p.id === chosen.id) ? [chosen, ...visible] : visible;
  return (
    <div className="provider-picker">
      <input
        className="settings-input provider-picker-filter"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="filter providers…"
        spellCheck={false}
        autoComplete="off"
        aria-label="Filter providers"
      />
      <Select
        fill
        ariaLabel={ariaLabel}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        options={listed.map((p) => ({ value: p.id, label: p.name }))}
      />
    </div>
  );
};
