// FieldControls — the plain controls: a line, a paragraph, a number, a switch.
//
// Every one of these serves fields that, until 2026-08-31, had no control at
// all. POSITIONING, MESSAGE, VOICE, CLAIMS, LEGAL, ASSET RULES, ACCESSIBILITY
// and CHANNELS — twenty of the kit's thirty-nine gated fields — were reachable
// only by hand-editing JSON in a textarea at the bottom of the panel.
//
// THE LABEL CARRIES THE GATE'S OWN `why`. Not a placeholder we wrote: the
// sentence the being is refused with. […] tells an operator what the field is FOR; "Rise" tells
// them what it is called, which they could already see.

import { Select } from '../Select.jsx';

/** The label above every control: name, reason, and whether it is still a gap.
 *  The gap mark rides HERE, on the field, rather than in a list elsewhere —
 *  the old panel named missing paths three sections away from any box that
 *  could answer them. */
export const FieldLabel = ({ field, gap }) => (
  <span className="label-data bk-flabel">
    {field.label}
    {gap ? <b className="bk-gap" title="still needed before anything goes out under this brand">·</b> : null}
    {field.why ? <em>{field.why}</em> : null}
  </span>
);

export const TextField = ({ field, value, onChange, gap }) => (
  <label className="bk-field">
    <FieldLabel field={field} gap={gap} />
    <input
      type="text"
      value={typeof value === 'string' ? value : ''}
      placeholder={field.placeholder || ''}
      spellCheck="false"
      onChange={(e) => onChange(field.path, e.target.value)}
    />
  </label>
);

export const ProseField = ({ field, value, onChange, gap }) => (
  <label className="bk-field bk-field-wide">
    <FieldLabel field={field} gap={gap} />
    <textarea
      value={typeof value === 'string' ? value : ''}
      placeholder={field.placeholder || ''}
      rows={4}
      onChange={(e) => onChange(field.path, e.target.value)}
    />
  </label>
);

/**
 * A number, and only ever a number.
 *
 * ⚠️ The gate holds these to `Number.isFinite`, so a string "96" does NOT
 * satisfy `logoRules.minWidthPx` — it would leave a kit reading one short with
 * a filled-in box, which is the most confusing state a form can be in. An empty
 * box unsets rather than storing NaN.
 */
export const NumberField = ({ field, value, onChange, onUnset, gap }) => (
  <label className="bk-field">
    <FieldLabel field={field} gap={gap} />
    <span className="bk-num">
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        step={field.step || 1}
        onChange={(e) => {
          const text = e.target.value;
          if (text.trim() === '') return onUnset(field.path);
          const n = Number(text);
          return Number.isFinite(n) ? onChange(field.path, n) : undefined;
        }}
      />
      {field.unit ? <span className="label-data">{field.unit}</span> : null}
    </span>
  </label>
);

/**
 * A yes/no that can also be UNANSWERED.
 *
 * A plain checkbox has two states and this field has three: the gate wants a
 * real boolean, and `undefined` is neither true nor false — it means nobody
 * decided. A checkbox defaulting to unchecked would read as a decided "no" and
 * quietly satisfy nothing, so the choice is explicit.
 */
export const ToggleField = ({ field, value, onChange, gap }) => (
  <div className="bk-field">
    <FieldLabel field={field} gap={gap} />
    <Select
      id={`bk-${field.path.replace(/\./g, '-')}`}
      fill
      ariaLabel={field.label}
      value={typeof value === 'boolean' ? String(value) : ''}
      options={[{ value: 'true', label: 'REQUIRED' }, { value: 'false', label: 'NOT REQUIRED' }]}
      placeholder="NOT DECIDED"
      onChange={(picked) => onChange(field.path, picked === 'true')}
    />
  </div>
);
