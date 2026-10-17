// MarksSection — the artwork, which was the one part of a kit the panel could
// not author at all.
//
// `marks.wordmark` is a gated field of kind `object`, and the only way to fill
// it was to hand-write `{"file": "wordmark.svg", "recolor": {"#000000":"ink"}}`
// into the raw JSON and separately copy an SVG into a folder the panel never
// named. `marks.mask` was not even gated until 2026-08-31, despite five of the
// six templates composing around it.
//
// EACH MARK IS SHOWN ON THREE GROUNDS: black, white, and this brand's own `bg`.
// Both Umbrae marks are drawn in pure #000000 with no background — built for
// light surfaces, and INVISIBLE on a near-black card until the recolour rule
// swaps them. A single preview on one ground is how a white-on-white logo
// ships; three is how it gets caught here instead.
//
// THE RECOLOUR MAP IS SHOWN, because it is the difference between a mark that
// draws and one that vanishes. From brand-tokens.js: […]

import { useRef, useState } from 'react';
import { uploadBrandMark } from '../../../services/brands.js';
import { uiSound } from '../../../services/ui-sound.js';
import { Lightbox } from '../Lightbox.jsx';
import { EmptyState } from '../empty-state.jsx';
import { useKit } from './kit-context.js';

/** The grounds a mark is judged against. */
const GROUNDS = [
  { id: 'brand', label: 'ON THE BRAND' },
  { id: 'black', label: 'ON BLACK', color: '#000000' },
  { id: 'white', label: 'ON WHITE', color: '#ffffff' },
];

// Each ground tile is a door (2026-09-01): clicking it hangs the mark full
// size in the Lightbox — a logo judged at 56px tall is a logo shipped
// unexamined, the same way a staged post's image was.
const MarkBoard = ({ name, rule, art, bg, onDrop, onZoom }) => (
  <section className="bk-mark cham">
    <div className="cham-in">
      <header className="bk-mark-head">
        <h5 className="label-data">{name}</h5>
        <span className="label-data bk-mark-file">{rule?.file || 'NO FILE DECLARED'}</span>
        <button type="button" className="bk-mark-swap" onClick={() => onDrop(name)}>REPLACE</button>
      </header>
      {art ? (
        <div className="bk-mark-grounds">
          {GROUNDS.map((ground) => (
            <div key={ground.id} className="bk-mark-ground">
              <button
                type="button"
                className="bk-mark-zoom"
                style={{ background: ground.color || bg || '#000' }}
                aria-label={`view ${name} ${ground.label.toLowerCase()} full size`}
                onClick={() => { uiSound('toggle'); onZoom({ name, ground: ground.label, color: ground.color || bg || '#000' }); }}
              >
                <img src={art} alt={`${name} on ${ground.label.toLowerCase()}`} />
              </button>
              <span className="label-data">{ground.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="bk-error">
          this mark does not load — {rule?.file
            ? `no marks/${rule.file} in this brand's folder`
            : 'the kit names no file for it'}
        </p>
      )}
      {rule?.recolor && Object.keys(rule.recolor).length ? (
        <p className="bk-mark-recolor label-data">
          RECOLOURED{' '}
          {Object.entries(rule.recolor).map(([from, token]) => (
            <span key={from}><i style={{ background: from }} aria-hidden="true" />{from} → {token}</span>
          ))}
        </p>
      ) : (
        <p className="bk-mark-recolor label-data">NO RECOLOUR — drawn exactly as supplied</p>
      )}
    </div>
  </section>
);

export const MarksSection = ({ gaps }) => {
  const { draft, marks, editField, brand, reloadMarks } = useKit();
  const fileRef = useRef(null);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The loupe over a mark's ground — one at the section root, fed by
  // whichever tile opened it. It holds only the CHOICE; the art is read
  // live at render, so a marks reload that lands while it is open swaps
  // in the fresh file instead of leaving the operator judging the old one.
  const [zoom, setZoom] = useState(null);
  const declared = draft?.marks && typeof draft.marks === 'object' ? draft.marks : {};
  // Every mark the CARDS need, so one the kit has not declared still appears
  // with somewhere to put a file — rather than being invisible until a card
  // refuses.
  const names = [...new Set([...Object.keys(declared), ...(marks?.needed || []).map((m) => m.key)])];

  const pick = (name) => { setTarget(name); setError(null); fileRef.current?.click(); };

  const send = async (file) => {
    if (!file || !target) return;
    setBusy(true);
    try {
      const saved = await uploadBrandMark(brand, target, file);
      // Declaring it is a separate act from storing it: the kit must NAME the
      // file or the renderer will not look for it.
      editField(`marks.${target}.file`, saved.file);
      await reloadMarks();
      setError(null);
    } catch (err) {
      setError(err?.message || 'the mark could not be saved');
    } finally {
      setBusy(false);
      setTarget(null);
    }
  };

  return (
    <div className="bk-marks">
      {names.length === 0 ? <EmptyState title="NO MARKS YET" /> : null}
      {names.map((name) => (
        <MarkBoard
          key={name}
          name={name}
          rule={declared[name]}
          art={marks?.marks?.[name]}
          bg={draft?.colors?.bg}
          onDrop={pick}
          onZoom={setZoom}
        />
      ))}

      {gaps?.length ? (
        <p className="bk-note">
          {gaps.join(' and ')} {gaps.length === 1 ? 'is' : 'are'} still needed.
          A mark is the one thing in a kit nobody can invent for you.
        </p>
      ) : null}

      <p className="bk-band bk-band-soft">
        {busy ? 'SAVING…' : 'Drop an SVG in, or put one here yourself:'}
        <code>{marks?.where || '—'}</code>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(marks?.where || '')}
          disabled={!marks?.where}
        >
          COPY PATH
        </button>
      </p>
      {error ? <p className="bk-error">{error}</p> : null}

      {/* ⚠️ SVG only. A mark is line art and gets drawn at 1600px — a raster
          logo is a blurry logo, and the route refuses one anyway. */}
      <input
        ref={fileRef}
        type="file"
        accept=".svg,image/svg+xml"
        hidden
        onChange={(e) => { send(e.target.files?.[0]); e.target.value = ''; }}
      />

      {/* Predicated on the art standing: a marks reload that dropped this
          mark closes the door — an <img src=""> resolves against the
          document and re-requests the page, hanging nothing worth judging. */}
      {zoom && marks?.marks?.[zoom.name] ? (
        <Lightbox
          src={marks.marks[zoom.name]}
          alt={`${zoom.name} mark`}
          caption={`${zoom.name} · ${zoom.ground}`}
          ground={zoom.color}
          vector
          onClose={() => setZoom(null)}
        />
      ) : null}
    </div>
  );
};
