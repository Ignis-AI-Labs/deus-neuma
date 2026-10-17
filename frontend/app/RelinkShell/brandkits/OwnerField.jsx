// OwnerField — the house member answerable for this brand.
//
// Design note, 2026-08-31: […]
//
// Witnesses are deliberately not offered: a sealed AI witness stands BESIDE the
// house and cannot be the member answerable for a brand. `houseMembers()` is
// passed a null active companion on purpose — this is a roster, not a switcher,
// and who you are talking to has no bearing on who owns a brand.

import { Select } from '../Select.jsx';
import { houseMembers } from '../house-members.js';
import { ownerOptions } from './brand-kits-view.js';
import { FieldLabel } from './FieldControls.jsx';
import { useKit } from './kit-context.js';

export const OwnerField = ({ field, value, onChange, gap }) => {
  const { roster } = useKit();
  const options = ownerOptions(houseMembers(roster, null), value);
  return (
    <div className="bk-field">
      <FieldLabel field={field} gap={gap} />
      <Select
        id="bk-owner"
        fill
        ariaLabel="the house member answerable for this brand"
        value={typeof value === 'string' ? value : ''}
        options={options}
        placeholder={options.length ? 'CHOOSE A HOUSE MEMBER' : 'NO HOUSE MEMBERS YET'}
        disabled={!options.length}
        onChange={(picked) => onChange(field.path, picked)}
      />
    </div>
  );
};
