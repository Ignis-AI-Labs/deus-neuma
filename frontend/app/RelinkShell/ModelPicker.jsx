// ModelPicker - all model dropdowns ride the global LINE & CYCLE Select.
// A manual field remains available for custom endpoints that publish no list.

import { useEffect, useState } from 'react';
import { Select } from './Select.jsx';
import { modelOptions } from './model-options.js';
import './ModelPicker.css';

/**
 * Render model choices through the global Select with a custom-id fallback.
 * @param {object} props Component properties.
 * @returns {import('react').ReactElement} Model picker.
 */
export const ModelPicker = ({ models, value, onChange, ariaLabel = 'Model', placeholder = 'model id' }) => {
  const options = modelOptions(models, value);
  const publishedCount = (models || []).length;
  const [manual, setManual] = useState(options.length === 0);

  useEffect(() => {
    if (publishedCount > 0) setManual(false);
  }, [publishedCount]);

  return (
    <div className="model-picker">
      <div className="model-picker-control">
        {manual ? (
          <input
            className="settings-input"
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            aria-label={ariaLabel}
            autoComplete="off"
            spellCheck={false}
          />
        ) : (
          <Select
            fill
            ariaLabel={ariaLabel}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            options={options}
          />
        )}
        <button
          type="button"
          className="settings-set model-picker-mode"
          onClick={() => setManual((current) => !current)}
          disabled={options.length === 0}
        >
          {options.length === 0 ? 'MANUAL ONLY' : manual ? 'MODEL LIST' : 'MANUAL ID'}
        </button>
      </div>
      <span className="model-picker-count label-data">
        {publishedCount} AVAILABLE MODEL{publishedCount === 1 ? '' : 'S'}
      </span>
    </div>
  );
};
