// use-kit-cards — the company's cards: which card types it draws, which are its own designs, and
// a thumbnail of each drawn from the kit in hand (brand-card-routes.js, card-gallery.js).
//
// THUMBNAILS ARE DRAWN ONE AT A TIME, ON DEMAND. Eleven previews at once on every keystroke would
// be the preview's own cost times eleven; the gallery asks for them when it is open and redraws
// them when asked (after a save, or when the kit changed since). impure — network.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listBrandCards, previewBrandCard } from '../../../services/brands.js';

export const useKitCards = (brand) => {
  const [gallery, setGallery] = useState(null);
  const [error, setError] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const run = useRef(0);

  const reload = useCallback(async () => {
    if (!brand) { setGallery(null); return; }
    try {
      setGallery(await listBrandCards(brand));
      setError(null);
    } catch (err) {
      setError(err?.message || 'the cards could not be read');
    }
  }, [brand]);

  useEffect(() => { setThumbs({}); reload(); }, [reload]);

  // Every card's thumbnail from the kit in hand, one after another; a newer pass ends an older one.
  const drawThumbs = useCallback(async (kit) => {
    if (!brand || !kit || !gallery?.cards) return;
    const mine = run.current + 1;
    run.current = mine;
    for (const card of gallery.cards) {
      if (run.current !== mine) return;
      try {
        const answer = await previewBrandCard(brand, { kit, template: card.name });
        if (run.current !== mine) return;
        setThumbs((t) => ({ ...t, [card.name]: answer.ok ? { svg: answer.svg } : { errors: answer.errors } }));
      } catch (err) {
        setThumbs((t) => ({ ...t, [card.name]: { errors: [err?.message || 'could not be drawn'] } }));
      }
    }
  }, [brand, gallery]);

  return { gallery, error, reload, thumbs, drawThumbs };
};
