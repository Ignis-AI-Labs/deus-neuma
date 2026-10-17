// TypeRoleCard — one typographic job, and an honest specimen of it.
//
// The three fields under a role are shown together because they are one
// decision. A face at 300 on 0.16em tracking is a different typeface from the
// same face at 700 on none — which is precisely how Umbrae's cards drew wrong
// for a week while the kit named all three families correctly.
//
// THE SPECIMEN APPLIES ALL THREE. The old one applied only `fontFamily`, and it
// took the row's own value — so the DISPLAY WEIGHT row rendered […] in a font called "900". This one sets family, weight and tracking
// together, in the bytes the card will actually be drawn from.

import { Select } from '../Select.jsx';
import {
  firstFamily, composeStack, faceStanding, familyOptions, weightOptions,
  EMBEDDED, FAMILY_ONLY,
} from './type-roles.js';
import { atPath } from './brand-kits-view.js';

const BADGE = {
  [EMBEDDED]: { text: 'VENDORED', tone: 'ok' },
  [FAMILY_ONLY]: { text: 'WEIGHT NOT VENDORED', tone: 'warn' },
};

/** What the badge says when a family is not carried at all. */
const NOT_CARRIED = { text: 'NOT VENDORED', tone: 'bad' };

export const TypeRoleCard = ({ role, kit, families, onChange, gaps }) => {
  const stack = atPath(kit, role.family);
  const weight = atPath(kit, role.weight);
  const track = role.track ? atPath(kit, role.track) : null;
  const standing = faceStanding(families, stack, weight);
  const badge = BADGE[standing.state] || NOT_CARRIED;
  const missing = new Set(gaps || []);

  /** Choosing a family rewrites the whole stack, keeping the tail the registry
   *  declares for it — a mono face must fall back to mono, or a column of
   *  figures stops aligning the moment the face is unavailable. */
  const pickFamily = (family) => {
    const entry = families.find((f) => f.family === family);
    onChange(role.family, composeStack(family, entry?.tail));
  };

  return (
    <section className="bk-role cham">
      <div className="cham-in">
        <header className="bk-role-head">
          <h5 className="label-data">
            {role.label}
            {[role.family, role.weight, role.track].some((p) => p && missing.has(p))
              ? <b className="bk-gap">·</b> : null}
          </h5>
          <span className="label-data bk-role-why">{role.why}</span>
          <span className={`bk-badge label-data is-${badge.tone}`} title={
            standing.state === FAMILY_ONLY
              ? `this build carries ${firstFamily(stack)} at ${standing.has.join(', ')} — a card asking for ${weight} is drawn in a weight nobody chose`
              : standing.state === EMBEDDED
                ? `cards are drawn from this repository's own copy of ${firstFamily(stack)}`
                : 'no file for this family ships with the platform, so a card is drawn in whatever the render machine happens to have'
          }>
            {badge.text}
          </span>
        </header>

        <div className="bk-role-controls">
          <div className="bk-field">
            <span className="label-data">FAMILY</span>
            <Select
              id={`bk-fam-${role.id}`}
              fill
              ariaLabel={`${role.label} family`}
              value={firstFamily(stack)}
              options={familyOptions(families, stack)}
              placeholder="CHOOSE A FACE"
              onChange={pickFamily}
            />
          </div>
          <div className="bk-field">
            <span className="label-data">WEIGHT</span>
            <Select
              id={`bk-wt-${role.id}`}
              fill
              ariaLabel={`${role.label} weight`}
              value={weight ? String(weight) : ''}
              options={weightOptions(families, stack, weight)}
              placeholder="CHOOSE A WEIGHT"
              onChange={(picked) => onChange(role.weight, picked)}
            />
          </div>
          {role.track ? (
            <label className="bk-field bk-field-narrow">
              <span className="label-data">TRACKING <em>in em</em></span>
              <input
                type="text"
                value={track || ''}
                placeholder="0.16em"
                spellCheck="false"
                onChange={(e) => onChange(role.track, e.target.value)}
              />
            </label>
          ) : null}
        </div>

        {/* The whole point. Real face, real weight, real tracking. */}
        <p
          className="bk-specimen"
          style={{
            fontFamily: stack || 'inherit',
            fontWeight: weight || 'normal',
            letterSpacing: track || 'normal',
            fontSize: `${role.size}px`,
          }}
        >
          {role.specimen}
        </p>
      </div>
    </section>
  );
};
