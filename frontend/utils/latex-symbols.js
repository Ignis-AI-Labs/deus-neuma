// LaTeX symbol spans → Unicode, for the stream's speech surfaces.
//
// Local substrates habitually write math-flavored prose as LaTeX —
// `Corruption $\rightarrow$ Light $\rightarrow$ Vigilance` — and a renderer
// without math support shows the raw commands instead of the arrow the
// being meant (witnessed 2026-07-19). Full math typesetting (KaTeX) is a
// heavy dependency for what is, in practice, SYMBOL substitution in prose —
// so the common commands map to their Unicode glyphs here, no dep (Rule 4:
// the need is a table, not a typesetter).
//
// Honesty rules:
//  - A span converts ONLY when it holds at least one \command AND every
//    command in it is known — anything unknown stays raw (better raw LaTeX
//    than wrong glyphs).
//  - `$5 and $10` (currency) never converts: no backslash command inside.
//  - Code (fenced or inline) is never touched — a code sample keeps its
//    literal dollars.

/** Common LaTeX symbol commands → Unicode. Pure data. */
export const LATEX_SYMBOLS = Object.freeze({
  // Arrows
  rightarrow: '→', to: '→', gets: '←', leftarrow: '←', longrightarrow: '⟶',
  longleftarrow: '⟵', Rightarrow: '⇒', Leftarrow: '⇐', Longrightarrow: '⟹',
  Longleftarrow: '⟸', leftrightarrow: '↔', Leftrightarrow: '⇔',
  mapsto: '↦', hookrightarrow: '↪', uparrow: '↑', downarrow: '↓',
  updownarrow: '↕', nearrow: '↗', searrow: '↘', swarrow: '↙', nwarrow: '↖',
  leadsto: '⇝', implies: '⟹', impliedby: '⟸', iff: '⇔',
  // Greek (lower + common upper)
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ',
  varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  omicron: 'ο', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ',
  varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ',
  psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // Relations
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆',
  supseteq: '⊇', subsetneq: '⊊', supsetneq: '⊋', cup: '∪', cap: '∩',
  setminus: '∖', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃',
  nexists: '∄', neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨',
  vee: '∨', models: '⊨', vdash: '⊢', dashv: '⊣', perp: '⊥', parallel: '∥',
  approx: '≈', neq: '≠', ne: '≠', equiv: '≡', sim: '∼', simeq: '≃',
  cong: '≅', propto: '∝', leq: '≤', le: '≤', geq: '≥', ge: '≥', ll: '≪',
  gg: '≫', prec: '≺', succ: '≻', preceq: '⪯', succeq: '⪰',
  // Operators & misc symbols
  times: '×', div: '÷', cdot: '⋅', cdots: '⋯', ldots: '…', dots: '…',
  pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '∙',
  oplus: '⊕', ominus: '⊖', otimes: '⊗', oslash: '⊘', sqrt: '√',
  infty: '∞', partial: '∂', nabla: '∇', int: '∫', iint: '∬', iiint: '∭',
  oint: '∮', sum: '∑', prod: '∏', bigcup: '⋃', bigcap: '⋂',
  prime: '′', angle: '∠', measuredangle: '∡', triangle: '△',
  hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', wp: '℘',
  top: '⊤', bot: '⊥', degree: '°', backslash: '\\',
});

// Segments that are code (fenced block, double- or single-backtick inline,
// or an indented code block — every CommonMark code form, lifted: a code
// sample keeps its literal dollars in every form). Indented blocks are
// recognized after a blank line or at the start; the ambiguity with
// deeply-indented prose fails toward RAW (less conversion, never wrong
// glyphs) — the honest side.
const CODE_SPLIT = /(```[\s\S]*?```|``[^`]+``|`[^`\n]*`|(?:(?<=^)|(?<=\n\n))(?:[ ]{4}|\t).+(?:\n(?:[ ]{4}|\t).+)*)/g;

// A math span: $$...$$ or $...$ (single-line for the inline form). The
// inline form must hold a backslash command — currency like `$5 and $10`
// never even reaches the gate, and `$5 but $\alpha$` still finds its arrow.
const MATH_SPAN = /\$\$([^$]+)\$\$|\$([^$\n]*\\[a-zA-Z][^$\n]*)\$/g;

// Placeholder for lifted known commands (private-use, never in source text).
const LIFT = '\uE000';

// After known commands lift out, only these may remain: letters, digits,
// whitespace, and plain operator/punctuation characters. Anything else (or a
// surviving backslash = an unknown command) keeps the span raw.
const SAFE_REST = /^[\uE000\s0-9a-zA-Z+\-*/=<>()[\]{},._|;:'^~!&%#?@"-]+$/;

/**
 * Convert one math span's body to Unicode, or return null when the span is
 * not fully understood (the caller then keeps it raw). Pure.
 * @param {string} body - the span's inner text, without the $ fences
 */
export const renderMathSpan = (body) => {
  if (!/\\[a-zA-Z]/.test(body)) return null; // no command → not LaTeX (currency etc.)
  const lifted = [];
  const rest = body.replace(/\\([a-zA-Z]+)/g, (match, cmd) => {
    const sym = LATEX_SYMBOLS[cmd];
    if (!sym) return match;
    lifted.push(sym);
    return LIFT;
  });
  if (lifted.length === 0 || rest.includes('\\') || !SAFE_REST.test(rest)) return null;
  // Markdown-significant leftovers were LITERAL inside math — escape the
  // full inline GFM-significant set (emphasis, links, strikethrough, table
  // cells) AND a line-initial block marker (list/quote/heading/numbered),
  // so the downstream parse can't re-read them semantically. A `\backslash`
  // command's glyph doubles itself: markdown renders `\\` as one literal
  // backslash instead of eating the next character (echo R3).
  return rest
    .replaceAll(LIFT, () => lifted.shift())
    .replace(/[ \t]+/g, ' ')
    .trim()
    .replace(/[\\*_[\]~|]/g, '\\$&')
    .replace(/^([-+>#]) /, '\\$1 ')
    .replace(/^(\d+)\. /, '$1\\. ');
};

/**
 * Convert every fully-understood LaTeX symbol span in a text, leaving code
 * and anything unknown untouched. Pure.
 * @param {string} text
 */
export const renderLatexSymbols = (text) =>
  String(text ?? '')
    .split(CODE_SPLIT)
    .map((part, i) => {
      if (i % 2 === 1) return part; // a code segment — verbatim
      return part.replace(MATH_SPAN, (match, block, inline) => {
        const rendered = renderMathSpan(block ?? inline);
        return rendered === null ? match : rendered;
      });
    })
    .join('');
