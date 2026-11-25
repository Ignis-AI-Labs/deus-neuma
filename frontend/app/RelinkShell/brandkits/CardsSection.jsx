// CardsSection — every card a company draws, laid out to be seen and opened one at a time.
//
// Design note, 2026-11-16: […] So the section is a gallery: each card type drawn in this kit,
// marked by whether it is the company's own design, the shared layout every company draws, or its
// own but still too like another company's (card-likeness.js). A tile opens the designer.
// impure — network.

import { useEffect, useState } from 'react';
import { useKit } from './kit-context.js';
import { Select } from '../Select.jsx';
import { InlineSvg } from './InlineSvg.jsx';
import { CardDesigner } from './CardDesigner.jsx';
import { cardStanding, gallerySummary, newCardNameRefusal } from './card-gallery-view.js';
import { getBrandCard, saveBrandCard } from '../../../services/brands.js';

const NewCardType = ({ gallery, onCancel, onMade }) => {
  const { brand } = useKit();
  const [name, setName] = useState('');
  const [base, setBase] = useState(gallery.cards[0]?.name || '');
  const [failure, setFailure] = useState(null);
  const refusal = name ? newCardNameRefusal(name, gallery) : null;
  const make = async () => {
    try {
      const from = await getBrandCard(brand, base);
      await saveBrandCard(brand, name, { svg: from.svg, spec: { ...from.spec, title: name } });
      onMade(name);
    } catch (err) {
      setFailure(err?.message || 'the card type could not be made');
    }
  };
  return (
    <div className="bk-card-new">
      <label className="bk-field">
        <span className="label-data">NEW CARD TYPE — ITS NAME</span>
        <input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="e.g. pool-spotlight" aria-label="the new card type's name" />
      </label>
      <div className="bk-field">
        <span className="label-data">START FROM</span>
        <Select
          id="bk-card-base"
          ariaLabel="the card the new one starts from"
          value={base}
          options={gallery.cards.map((c) => ({ value: c.name, label: (c.title || c.name).toUpperCase() }))}
          onChange={setBase}
        />
      </div>
      {refusal ? <p className="bk-error">{refusal}</p> : null}
      {failure ? <p className="bk-error">{failure}</p> : null}
      <div className="bk-designer-acts">
        <button type="button" className="bk-save label-data" disabled={!name || Boolean(refusal) || !base} onClick={make}>MAKE IT</button>
        <button type="button" className="bk-quiet label-data" onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  );
};

export const CardsSection = () => {
  const { brand, draft, cards } = useKit();
  const [open, setOpen] = useState(null);
  const [making, setMaking] = useState(false);
  const { gallery, error, thumbs, drawThumbs, reload } = cards;

  // Drawn when the gallery arrives or is returned to — from the kit in hand, unsaved edits included.
  useEffect(() => { if (!open && gallery) drawThumbs(draft); }, [open, gallery]); // eslint-disable-line react-hooks/exhaustive-deps

  if (open) {
    return (
      <CardDesigner
        template={open}
        card={gallery?.cards.find((c) => c.name === open)}
        onBack={() => setOpen(null)}
        onChanged={reload}
      />
    );
  }
  const name = draft?.name || brand;
  return (
    <div className="bk-section">
      <header className="bk-section-head">
        <h4 className="label-data">CARDS<span className="bk-section-n">{gallery ? `${gallery.own}/${gallery.cards.length - (gallery.retired || 0)} OWN${gallery.retired ? ` · ${gallery.retired} NOT USED` : ''}` : ''}</span></h4>
        <p className="bk-note">{gallery ? gallerySummary(gallery, name) : (error || 'READING THE CARDS…')}</p>
      </header>
      {gallery && !making ? (
        <button type="button" className="bk-quiet label-data" onClick={() => setMaking(true)}>+ NEW CARD TYPE</button>
      ) : null}
      {gallery && making ? (
        <NewCardType gallery={gallery} onCancel={() => setMaking(false)} onMade={async (made) => { setMaking(false); await reload(); setOpen(made); }} />
      ) : null}
      <ul className="bk-card-grid">
        {/* The cards the company uses first; the ones it retired stand last, dimmed. */}
        {[...(gallery?.cards || [])].sort((a, b) => Number(Boolean(a.retired)) - Number(Boolean(b.retired))).map((card) => {
          const standing = cardStanding(card, name);
          const thumb = thumbs[card.name];
          return (
            <li key={card.name} data-card={card.name} data-card-retired={card.retired ? '' : undefined}>
              <button type="button" className={`bk-card-tile bk-card-tone-${standing.tone}`} onClick={() => setOpen(card.name)} title={standing.detail}>
                <span className="bk-card-thumb">
                  {thumb?.svg ? <InlineSvg svg={thumb.svg} label={`${card.name} card`} /> : (
                    <span className="bk-empty label-data">
                      {thumb?.errors ? 'CANNOT BE DRAWN YET' : 'DRAWING…'}
                      {thumb?.errors ? <small className="bk-card-why">{thumb.errors[0]}</small> : null}
                    </span>
                  )}
                </span>
                <span className="bk-card-name label-data">{(card.title || card.name).toUpperCase()}</span>
                <span className="bk-card-standing label-data">{standing.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
