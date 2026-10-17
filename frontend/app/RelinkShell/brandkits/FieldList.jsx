// FieldList — renders a section straight from the spec.
//
// The old panel hand-wrote five sections in JSX, which is why the other eight
// did not exist. This walks whatever the server's form spec declares, so a
// field added to the gate gets a control the same day rather than becoming the
// twenty-first thing only reachable in raw JSON.
//
// ⚠️ IT RENDERS FROM THE SPEC, NEVER FROM Object.keys(kit). `setPath` deletes a
// key when a text field is cleared — by design, so an empty string never reads
// as a decided answer — and a form driven off the kit's own keys would make the
// box disappear the moment somebody emptied it.

import { FieldLabel, TextField, ProseField, NumberField, ToggleField } from './FieldControls.jsx';
import { ListField } from './ListField.jsx';
import { ChannelsField } from './ChannelsField.jsx';
import { OwnerField } from './OwnerField.jsx';
import { atPath } from './brand-kits-view.js';
import { useKit } from './kit-context.js';

const CONTROLS = {
  text: TextField,
  prose: ProseField,
  number: NumberField,
  toggle: ToggleField,
  list: ListField,
  channels: ChannelsField,
  owner: OwnerField,
};

/** A control the spec named but this build does not have. Says so plainly
 *  rather than rendering nothing — a field that silently vanishes is exactly
 *  the failure this whole layer exists to end. */
const Unknown = ({ field }) => (
  <div className="bk-field">
    <FieldLabel field={field} />
    <p className="bk-error">
      this build has no “{field.control}” control — edit {field.path} in THE WHOLE KIT below
    </p>
  </div>
);

export const FieldList = ({ section, gaps }) => {
  const { draft, editField, unsetField } = useKit();
  const missing = new Set(gaps || []);
  return (
    <div className="bk-fields">
      {section.fields.map((field) => {
        const Control = CONTROLS[field.control] || Unknown;
        return (
          <Control
            key={field.path}
            field={field}
            value={atPath(draft, field.path)}
            onChange={editField}
            onUnset={unsetField}
            gap={missing.has(field.path)}
          />
        );
      })}
    </div>
  );
};
