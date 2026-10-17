// ContrastPanel — the brand, checked against the floor the brand set itself.
//
// Every kit declares `accessibility.contrastMin` and nothing had ever read it.
// A number written down and never enforced is a comment — the same failure as
// `logoRules.misuse` naming a rule the renderer was breaking while the doctrine
// said […].
//
// The verdict is against the KIT'S OWN number, not one we chose. A brand that
// set itself 7 is not passing at 4.6, and a brand that set 4.5 is not failed
// for missing AAA. AA/AAA are still named because that is the shared
// vocabulary, but the pass is the brand's own.
//
// ⚠️ It measures COMPOSITED colour. Half of Umbrae's ink roles are translucent;
// treating those as opaque reports a ratio the reader never experiences, and
// errs in the flattering direction.

import { contrastRatio, contrastVerdict } from './contrast.js';
import { measurablePairs } from './colour-bands.js';

export const ContrastPanel = ({ kit }) => {
  const floor = kit?.accessibility?.contrastMin;
  const pairs = measurablePairs(kit);
  if (!pairs.length) return null;

  const rows = pairs.map((pair) => ({
    ...pair,
    verdict: contrastVerdict(contrastRatio(kit.colors[pair.fg], kit.colors[pair.bg]), floor),
  }));
  const failing = rows.filter((r) => r.verdict.tone === 'fail');

  return (
    <section className="bk-contrast">
      <h5 className="label-data">
        CONTRAST
        <em>
          {Number.isFinite(floor)
            ? `against this brand's own floor of ${floor}`
            : 'this kit has not set a contrast floor — measured against 4.5'}
        </em>
      </h5>
      <ul>
        {rows.map((row) => (
          <li key={`${row.fg}/${row.bg}`} className={`is-${row.verdict.tone}`}>
            <span className="bk-pair label-data">
              <i style={{ background: kit.colors[row.bg] }} aria-hidden="true" />
              <i style={{ background: kit.colors[row.fg] }} aria-hidden="true" />
              {row.fg} on {row.bg}
            </span>
            <span className="bk-pair-why">{row.why}</span>
            <span className="bk-pair-n label-data">{row.verdict.text}</span>
          </li>
        ))}
      </ul>
      {failing.length ? (
        <p className="bk-note">
          {failing.map((r) => r.fg).join(', ')}
          {failing.length === 1 ? ' sits' : ' sit'} below the floor this kit declares.
          A ratio marked AA LARGE clears the standard only at 24px and above —
          which on a 1600px card means about 46px, the same mobile floor the
          card templates hold themselves to.
        </p>
      ) : null}
    </section>
  );
};
