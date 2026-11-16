// CardDesigner — one of a company's cards, redesigned in place.
//
// Design note, 2026-11-16: cards […]. The design is the card's own SVG and its fields, edited here and drawn as typed
// against the kit in hand (the preview route draws an unsaved design after holding it to
// card-safety.js). A shared card is made this company's own by saving it, changed or not; from
// then on every card of that name this company posts is drawn from this design. impure — network.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBrandCard, previewBrandCard, saveBrandCard, dropBrandCard } from '../../../services/brands.js';
import { useKit } from './kit-context.js';
import { InlineSvg } from './InlineSvg.jsx';
import { cardStanding } from './card-gallery-view.js';

const SETTLE_MS = 450;
const asText = (spec) => JSON.stringify(spec ?? {}, null, 2);

// The names a design may draw from this kit, so a redesign never guesses one.
const placeholders = (kit, fields) => [
  ...Object.keys(kit?.colors || {}).map((k) => `{{token.${k}}}`),
  ...Object.keys(kit?.type || {}).map((k) => `{{font.${k}}}`),
  ...Object.keys(kit?.marks || {}).map((k) => `{{mark.${k}}}`),
  '{{brand.name}}', '{{brand.handle}}', '{{fontface}}',
  ...Object.keys(fields || {}).map((k) => `{{data.${k}}}`),
];

export const CardDesigner = ({ template, card, onBack, onChanged }) => {
  const { brand, draft } = useKit();
  const [saved, setSaved] = useState(null);
  const [svg, setSvg] = useState('');
  const [specText, setSpecText] = useState('');
  const [preview, setPreview] = useState({ svg: null, errors: null });
  const [state, setState] = useState({ busy: false, notice: null, failure: null });
  const abort = useRef(null);

  const load = useCallback(async () => {
    try {
      const got = await getBrandCard(brand, template);
      setSaved(got);
      setSvg(got.svg);
      setSpecText(asText(got.spec));
    } catch (err) {
      setState((s) => ({ ...s, failure: err?.message || 'this card could not be read' }));
    }
  }, [brand, template]);
  useEffect(() => { load(); }, [load]);

  const parsed = useMemo(() => {
    try { return { spec: JSON.parse(specText || '{}'), error: null }; } catch (err) { return { spec: null, error: `the fields are not JSON: ${err.message}` }; }
  }, [specText]);

  // Drawn as typed, once the typing settles; a newer draw ends an older one.
  useEffect(() => {
    if (!saved || !parsed.spec) return undefined;
    const timer = setTimeout(async () => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      try {
        const answer = await previewBrandCard(brand, { kit: draft, template, design: { svg, spec: parsed.spec }, signal: controller.signal });
        if (!controller.signal.aborted) setPreview(answer.ok ? { svg: answer.svg, errors: null } : { svg: null, errors: answer.errors });
      } catch (err) {
        if (!controller.signal.aborted && err?.name !== 'AbortError') setPreview({ svg: null, errors: [err?.message || 'could not be drawn'] });
      }
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [brand, draft, template, svg, parsed.spec, saved]);
  useEffect(() => () => abort.current?.abort(), []);

  const dirty = Boolean(saved) && (svg !== saved.svg || specText !== asText(saved.spec));
  const name = String(draft?.name || brand).toUpperCase();
  const act = async (fn, notice) => {
    setState({ busy: true, notice: null, failure: null });
    try {
      await fn();
      setState({ busy: false, notice, failure: null });
      await load();
      await onChanged();
    } catch (err) {
      setState({ busy: false, notice: null, failure: err?.message || 'that did not work' });
    }
  };
  const keep = () => act(() => saveBrandCard(brand, template, { svg, spec: parsed.spec }), `Saved. Every ${template} card ${name} posts is drawn from this design.`);
  const letGo = () => act(() => dropBrandCard(brand, template), card?.ownType ? `The ${template} card type is gone.` : `${name} draws the shared ${template} card again.`);

  if (!saved) {
    return (
      <div className="bk-section">
        <button type="button" className="bk-back label-data" onClick={onBack}>← ALL CARDS</button>
        <p className="bk-empty">{state.failure || 'OPENING THE DESIGN…'}</p>
      </div>
    );
  }
  const standing = card ? cardStanding(card, draft?.name || brand) : null;
  const own = saved.source === 'company';

  return (
    <div className="bk-section bk-designer">
      <header className="bk-section-head">
        <button type="button" className="bk-back label-data" onClick={onBack}>← ALL CARDS</button>
        <h4 className="label-data">{(saved.spec?.title || template).toUpperCase()} · {own ? `${name}'S OWN DESIGN` : 'SHARED LAYOUT'}</h4>
        {standing ? <p className={`bk-note bk-card-tone-${standing.tone}`}>{standing.detail}</p> : null}
      </header>

      <div className="bk-designer-stage">
        {preview.svg ? <InlineSvg svg={preview.svg} label={`${template} card, as designed`} /> : null}
        {preview.errors ? (
          <div className="bk-preview-refusal">
            <p className="label-data">THIS DESIGN CANNOT BE DRAWN YET</p>
            <ul>{preview.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        ) : null}
        {!preview.svg && !preview.errors ? <p className="bk-empty label-data">DRAWING…</p> : null}
      </div>

      <div className="bk-designer-acts">
        {!own && !dirty ? <button type="button" className="bk-save label-data" disabled={state.busy} onClick={keep}>MAKE IT {name}&rsquo;S OWN</button> : null}
        {dirty ? <button type="button" className="bk-save label-data" disabled={state.busy || Boolean(parsed.error)} onClick={keep}>SAVE THIS DESIGN</button> : null}
        {dirty ? <button type="button" className="bk-quiet label-data" disabled={state.busy} onClick={() => { setSvg(saved.svg); setSpecText(asText(saved.spec)); }}>UNDO CHANGES</button> : null}
        {own && !dirty ? (
          <button type="button" className="bk-quiet label-data" disabled={state.busy} onClick={letGo}>
            {card?.ownType ? 'DELETE THIS CARD TYPE' : 'BACK TO THE SHARED DESIGN'}
          </button>
        ) : null}
      </div>
      {state.notice ? <p className="bk-notice">{state.notice}</p> : null}
      {state.failure ? <p className="bk-error">{state.failure}</p> : null}

      <label className="bk-field bk-raw">
        <span className="label-data">THE DRAWING (SVG)</span>
        <textarea value={svg} spellCheck="false" rows={18} onChange={(e) => setSvg(e.target.value)} aria-label={`the ${template} card's drawing as SVG`} />
      </label>
      <label className="bk-field bk-raw">
        <span className="label-data">ITS FIELDS — the copy each card is given, and the most characters each holds</span>
        <textarea value={specText} spellCheck="false" rows={10} onChange={(e) => setSpecText(e.target.value)} aria-label={`the ${template} card's fields as JSON`} />
      </label>
      {parsed.error ? <p className="bk-error">{parsed.error}</p> : null}
      <details className="bk-designer-help">
        <summary className="label-data">WHAT A DESIGN CAN DRAW FROM THIS KIT</summary>
        <p className="bk-note">{placeholders(draft, parsed.spec?.fields).join('  ')}</p>
        <p className="bk-note">Shapes, text, gradients, patterns, filters, clips and masks. No scripts, links or outside files: images come from the kit&rsquo;s marks.</p>
      </details>
    </div>
  );
};
