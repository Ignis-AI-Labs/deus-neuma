// InlineSvg — a card's SVG, drawn in the page but sealed off from it.
//
// ⚠️ WHY A SHADOW ROOT AND NOT JUST dangerouslySetInnerHTML.
//
// The card templates carry <defs> with ids: `wash`, `grid`, `edge`, the accent
// glow. SVG ids share the DOCUMENT namespace, so an inline card puts `#grid`
// into the same pot as every other SVG on the desk — and `fill="url(#wash)"`
// resolves to whichever `#wash` the document found FIRST. Two previews open, or
// one preview beside any app SVG that happens to name a gradient the same way,
// and a card silently borrows another's fill. Silently, and only visually,
// which is the worst way for a rendering bug to present.
//
// A shadow root gives the card its own id namespace and costs nothing else. The
// one thing that has to cross the boundary does: `@font-face` cannot be scoped
// to a shadow root at all, and document-level font rules DO apply inside one —
// so use-embedded-faces.js installs them on the document and the card inside
// here draws in the real vendored bytes.
//
// ⚠️ WHY innerHTML IS SAFE HERE. `renderCardSvg` XML-escapes every substitution
// without exception (card-svg.js), and the template around them is our own
// source, not user content. Nothing an operator types reaches this markup
// unescaped. A reviewer will ask; this is the answer.

import { useEffect, useRef } from 'react';

export const InlineSvg = ({ svg, label }) => {
  const host = useRef(null);
  const shadow = useRef(null);

  useEffect(() => {
    if (!host.current) return;
    if (!shadow.current) shadow.current = host.current.attachShadow({ mode: 'open' });
    shadow.current.innerHTML = svg
      ? `<style>:host{display:block}svg{display:block;width:100%;height:auto}</style>${svg}`
      : '';
  }, [svg]);

  return <div ref={host} className="bk-svg" role="img" aria-label={label || 'card preview'} />;
};
