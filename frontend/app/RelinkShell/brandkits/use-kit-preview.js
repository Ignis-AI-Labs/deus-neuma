// use-kit-preview — the card, redrawn as the kit changes.
//
// SETTLE VERSUS DELIBERATE, the distinction LookSection.jsx already draws for
// its own persist. A deliberate act — switching template, switching section —
// renders NOW. A keystroke stream waits for it to stop. Rendering on every
// character would mean showing a refusal for `#22d3` on the way to `#22d3ee`,
// which teaches an operator to distrust the panel.
//
// The in-flight request is aborted when a newer one starts, so a slow render
// can never land after a fast one and paint a stale card.
//
// It is kept out of use-kit-draft.js deliberately: a preview that fails must
// not be able to touch saving.
//
// impure — network, timers.

import { useCallback, useEffect, useRef, useState } from 'react';
import { previewBrandCard } from '../../../services/brands.js';

const SETTLE_MS = 450;

export const useKitPreview = (brand, kit, { enabled = true } = {}) => {
  const [template, setTemplate] = useState('milestone');
  const [state, setState] = useState({ svg: null, errors: null, missing: [], loading: false });
  const abort = useRef(null);
  const timer = useRef(null);

  const draw = useCallback(async () => {
    if (!brand || !kit || !enabled) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState((s) => ({ ...s, loading: true }));
    try {
      const answer = await previewBrandCard(brand, { kit, template, signal: controller.signal });
      if (controller.signal.aborted) return;
      setState(answer.ok
        ? { svg: answer.svg, errors: null, missing: answer.missing || [], loading: false }
        : { svg: null, errors: answer.errors || ['this card could not be drawn'], missing: [], loading: false });
    } catch (err) {
      // An abort is the expected outcome of typing, not a failure to report.
      if (controller.signal.aborted || err?.name === 'AbortError') return;
      setState({ svg: null, errors: [err?.message || 'the card could not be drawn'], missing: [], loading: false });
    }
  }, [brand, kit, template, enabled]);

  // The kit is a new object on every edit, so this effect IS the keystroke
  // stream. Debounced here rather than at the call site for that reason.
  useEffect(() => {
    if (!enabled) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(draw, SETTLE_MS);
    return () => clearTimeout(timer.current);
  }, [draw, enabled]);

  // Switching template is deliberate — no wait.
  const chooseTemplate = useCallback((next) => {
    clearTimeout(timer.current);
    setTemplate(next);
  }, []);

  useEffect(() => () => { abort.current?.abort(); clearTimeout(timer.current); }, []);

  return { ...state, template, chooseTemplate, redraw: draw };
};
