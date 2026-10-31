// THE SECOND READER — which model seconds the legal office's readings (Founder,
// 2026-10-31). Before an opinion or a reading is recorded, a second reader
// judges each cited passage against its claim. The house's own model by
// default (nothing leaves this computer); any connected provider is the
// operator's choice, and the choice says plainly what leaves. Pure render.

import { Select } from './Select.jsx';

export const LegalReaderSection = ({ reader, choices, pick, busy, onPick, onSet }) => {
  const current = reader?.provider ?? 'house';
  const chosen = pick || current;
  return (
    <section className="legal-seat">
      <p className="legal-sec-head label-data">THE SECOND READER</p>
      <p className="legal-note">
        Before an opinion or a reading is recorded, a second reader checks that each cited passage really says what it is
        cited for, and is the provision named. By default it is your house&apos;s own model, on this computer.
      </p>
      <div className="legal-seat-controls">
        <Select
          fill
          ariaLabel="Second legal reader"
          value={chosen}
          onChange={onPick}
          disabled={busy || !choices?.length}
          options={(choices ?? []).map((c) => ({ value: c.provider, label: c.label }))}
        />
        <button type="button" className="sec-scan label-data" disabled={busy || chosen === current} onClick={onSet}>
          {busy ? 'WORKING…' : 'SET'}
        </button>
      </div>
    </section>
  );
};
