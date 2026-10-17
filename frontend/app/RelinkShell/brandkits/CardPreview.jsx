// CardPreview — the brand landing on the thing it is for.
//
// Design note, 2026-08-31: […]
//
// The most objective thing a brand kit has is the card it produces, and the
// panel never showed one — an operator picked a cyan and found out what it
// looked like by rendering a PNG from a CLI.
//
// IT DRAWS THE DRAFT. Not the saved kit: change a colour, see it, then decide.
// Previewing what is already on disk could only ever show you the past.
//
// A REFUSAL IS SHOWN, NOT SWALLOWED. `renderCardSvg` refuses rather than
// falling back, so a missing token means no card — and the reasons name the
// token. That is more useful than a blank frame, and it is the same text the
// CLI and the being's own render_card produce.

import { Select } from '../Select.jsx';
import { InlineSvg } from './InlineSvg.jsx';

const TEMPLATES = [
  { value: 'announcement', label: 'ANNOUNCEMENT' },
  { value: 'launch', label: 'LAUNCH' },
  { value: 'milestone', label: 'MILESTONE' },
  { value: 'stat', label: 'STAT ROW' },
  { value: 'listing', label: 'LISTING' },
  { value: 'partnership', label: 'PARTNERSHIP' },
];

export const CardPreview = ({ preview, onCollapse }) => (
  <aside className="bk-preview">
    <header className="bk-preview-head">
      <span className="label-data">PREVIEW</span>
      <Select
        id="bk-template"
        ariaLabel="which card to preview"
        value={preview.template}
        options={TEMPLATES}
        onChange={preview.chooseTemplate}
      />
      <button type="button" className="bk-collapse" onClick={onCollapse} aria-label="hide the preview">–</button>
    </header>

    <div className={`bk-preview-stage${preview.loading ? ' is-busy' : ''}`}>
      {preview.svg ? <InlineSvg svg={preview.svg} label={`${preview.template} card`} /> : null}
      {!preview.svg && preview.errors ? (
        <div className="bk-preview-refusal">
          <p className="label-data">THIS CARD CANNOT BE DRAWN YET</p>
          <ul>{preview.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      ) : null}
      {!preview.svg && !preview.errors ? <p className="bk-empty label-data">DRAWING…</p> : null}
    </div>

    {/* ⚠️ Said plainly, every time. The house rule is that a card drawing an
        invented figure is worse than no card; these figures are a fixed
        specimen set that exists to exercise the numerals, and nothing here can
        be downloaded or posted. */}
    <p className="bk-preview-note label-data">
      SAMPLE COPY — not this brand&rsquo;s figures
    </p>

    {preview.missing?.length ? (
      <ul className="bk-preview-missing">
        {preview.missing.map((m) => <li key={m}>{m}</li>)}
      </ul>
    ) : null}
  </aside>
);
