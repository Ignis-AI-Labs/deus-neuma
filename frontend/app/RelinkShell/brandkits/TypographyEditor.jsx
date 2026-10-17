// TypographyEditor — the four roles, and the faces they add up to.
//
// The eleven gated `type.*` fields, grouped under the four jobs the templates
// actually draw with. Same fields, same gate, arranged so the question Founder
// asked has an answer on screen: […]
//
// AND `embedFonts` IS VISIBLE AT LAST. It is the array that decides which bytes
// ride inside every card, and it was in no part of the old UI — so changing a
// family in the panel left the card embedding the old face, silently. It is
// shown here as read-only chips derived from the four roles above, and the
// button writes that derivation into the kit.
//
// ⚠️ DERIVED, NOT UNIONED. Adding to it can only ever grow it, and a face
// nothing draws is roughly 400KB of base64 in every card produced — which is
// the state brands/ignis/tokens.json is in right now, carrying three faces its
// type slots never name.

import { TYPE_ROLES, deriveEmbedFonts } from './type-roles.js';
import { TypeRoleCard } from './TypeRoleCard.jsx';
import { useEmbeddedFaces } from './use-embedded-faces.js';
import { useKit } from './kit-context.js';

export const TypographyEditor = ({ gaps }) => {
  const { draft, editField, families } = useKit();
  const derived = deriveEmbedFonts(families, draft);
  const carried = Array.isArray(draft?.embedFonts) ? draft.embedFonts : [];
  const drifted = derived.join(',') !== carried.slice().sort().join(',');

  // Install BOTH sets, so a specimen renders in the real bytes whether the kit
  // has been reconciled yet or not — the whole reason to show the difference is
  // that you can see it before you commit to it.
  useEmbeddedFaces(families, [...new Set([...derived, ...carried])]);

  return (
    <div className="bk-type">
      {TYPE_ROLES.map((role) => (
        <TypeRoleCard
          key={role.id}
          role={role}
          kit={draft}
          families={families}
          onChange={editField}
          gaps={gaps}
        />
      ))}

      <section className="bk-embed">
        <h5 className="label-data">
          FACES THAT RIDE INSIDE EVERY CARD
          <em>derived from the four roles above — not chosen separately</em>
        </h5>
        <ul className="bk-chips">
          {derived.length === 0
            ? <li className="is-none label-data">NONE — no role resolves to a vendored face</li>
            : derived.map((id) => <li key={id} className="label-data">{id}</li>)}
        </ul>
        {drifted ? (
          <p className="bk-band bk-band-soft">
            {carried.length
              ? `This kit currently embeds ${carried.join(', ')}. Faces no role names are dead weight in every card — roughly 400KB each.`
              : 'This kit embeds no faces, so its cards are drawn in whatever the render machine has.'}
            <button type="button" onClick={() => editField('embedFonts', derived)}>
              USE THE DERIVED SET
            </button>
          </p>
        ) : null}
      </section>
    </div>
  );
};
