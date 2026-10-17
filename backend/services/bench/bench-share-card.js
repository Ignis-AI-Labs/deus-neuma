/**
 * bench-share-card — a benchmark result as something people can post: a
 * LINE & CYCLE bar card (SVG, rasterized to PNG by the card pipeline's
 * Chromium) and a Markdown table for forums. Pure throughout.
 *
 * ONE RENDERER. The desk's SHARE preview is this SVG (faces supplied by the
 * browser) and the PNG is this SVG with the vendored faces embedded — what
 * the operator sees is what posts.
 *
 * HONEST BY CONSTRUCTION. Bars start at 0 on a fixed 0–100% scale (no
 * truncated axis inflating a gap); a series card states on its face that
 * every bar answered the same questions under the same protocol (the
 * comparability law bench-summary.js groups by) and cites the digest; a
 * proof card cites its integrity hash. Numbers wear text ink — the only
 * colored mark is the highlighted bar, which is also named by its label.
 */

import { escapeXml } from '../branding/card-svg.js';

export const CARD_SIZES = Object.freeze({
  '16x9': Object.freeze({ width: 1600, height: 900 }),
  '1x1': Object.freeze({ width: 1200, height: 1200 }),
  '4x5': Object.freeze({ width: 1080, height: 1350 }),
});

/** The faces the PNG embeds (keys of branding/embeddable-faces.js). */
export const CARD_FACES = Object.freeze(['inter-regular', 'inter-semibold', 'mono-light', 'mono-data']);

// LINE & CYCLE values (frontend/styles/tokens.css) — an SVG that leaves the
// desk cannot read CSS custom properties, so the card carries the values.
const INK = Object.freeze({
  void: '#000000',
  signal: '#5FE9FF',
  line: 'rgba(255,255,255,0.18)',
  grid: 'rgba(255,255,255,0.07)',
  primary: 'rgba(255,255,255,0.95)',
  secondary: 'rgba(255,255,255,0.70)',
  tertiary: 'rgba(255,255,255,0.50)',
});
// The layers below the highlight step up in lightness in ladder order
// (ordinal: each arm adds a layer), all recessive beside the signal bar.
const LAYER_GRAYS = Object.freeze(['#4A4F55', '#6B7178', '#8C939B', '#ADB4BB']);

const VOICE = "'Inter', sans-serif";
const DATA = "'JetBrains Mono', monospace";

const pct1 = (v) => `${(v * 100).toFixed(1)}%`;
const shortSha = (sha) => (typeof sha === 'string' ? `${sha.slice(0, 12)}…` : '—');
const dateOf = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : '');
const modelLabel = (s) => [s.model?.replace(/\.gguf$/i, ''), s.quantization && !String(s.model).includes(s.quantization) ? s.quantization : null]
  .filter(Boolean).join(' · ');

/** pure — the signed point delta of `value` over `base` (both ratios). */
const pointDelta = (value, base) => {
  const d = (value - base) * 100;
  const text = `${Math.abs(d).toFixed(1)} pts`;
  return d > 0.05 ? `+${text}` : d < -0.05 ? `−${text}` : '±0.0 pts';
};

/**
 * A comparable series (bench-summary's projection) as the card's chart
 * model. The highlighted bar is the most-layered arm present (NEUMA when it
 * ran) — the one the card is about. Pure.
 */
export const chartFromSeries = (series) => {
  const scored = series.arms.filter((a) => typeof a.value === 'number');
  const bare = scored.find((a) => a.arm === 'bare');
  const top = [...scored].reverse().find((a) => a.arm !== 'reference') ?? null;
  const meta = [
    series.n ? `n=${series.n}` : null,
    series.maxTokens ? `${series.maxTokens} tok` : null,
    series.temperature !== null && series.temperature !== undefined ? `temp ${series.temperature}` : null,
  ].filter(Boolean).join(' · ');
  return {
    title: String(series.suiteId).toUpperCase(),
    subtitle: modelLabel(series),
    meta,
    date: dateOf(series.finishedAt),
    bars: scored.map((a) => ({
      label: a.label,
      value: a.value,
      display: pct1(a.value),
      delta: bare && a !== bare ? pointDelta(a.value, bare.value) : null,
      highlight: a === top,
    })),
    deltaHeader: bare ? 'Δ vs BARE' : null,
    rowHeader: 'Arm',
    ordinal: true,
    footnote: scored.length > 1
      ? `Every bar answered the same ${series.n ?? ''} questions under the same protocol`.replace('  ', ' ')
      : `One arm measured on ${series.n ?? '?'} questions — no comparison on record for this protocol`,
    cite: `protocol sha256 ${shortSha(series.protocolSha256)}`,
    filenameStem: `neuma-bench-${series.suiteId}-${dateOf(series.finishedAt)}`,
  };
};

/** A proof certificate (bench-summary's projection) as the chart model. Pure. */
export const chartFromProof = (proof) => {
  const ratio = (p, t) => (t > 0 ? p / t : 0);
  const bars = proof.sections.map((s) => ({
    label: s.id.toUpperCase(),
    value: ratio(s.pass, s.total),
    display: `${pct1(ratio(s.pass, s.total))}  ${s.pass}/${s.total}`,
    delta: null,
    highlight: false,
  }));
  bars.push({
    label: 'TOTAL',
    value: ratio(proof.total.pass, proof.total.total),
    display: `${pct1(ratio(proof.total.pass, proof.total.total))}  ${proof.total.pass}/${proof.total.total}`,
    delta: null,
    highlight: true,
  });
  return {
    title: `PROOF SUITE v${proof.suiteVersion ?? '?'}`,
    subtitle: [proof.platformVersion ? `NEUMA ${proof.platformVersion}` : null, proof.gpu].filter(Boolean).join(' · '),
    meta: [`n=${proof.total.total}`, proof.temperature !== null ? `temp ${proof.temperature}` : null].filter(Boolean).join(' · '),
    date: dateOf(proof.finishedAt),
    bars,
    deltaHeader: null,
    rowHeader: 'Section',
    ordinal: false,
    footnote: 'Scored deterministically on the machine that served the model',
    cite: `integrity sha256 ${shortSha(proof.integrity)}`,
    filenameStem: `neuma-bench-proof-${dateOf(proof.finishedAt)}`,
  };
};

/** pure — clip text to an estimated width budget (px) at a font size. */
const fit = (text, px, size, perChar) => {
  const max = Math.max(4, Math.floor(px / (size * perChar)));
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const text = (x, y, body, { size, family = DATA, fill = INK.secondary, weight = 400, anchor = 'start', spacing = 0 }) =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${spacing ? ` letter-spacing="${spacing}"` : ''}>${escapeXml(body)}</text>`;

// One scored bar is not a chart — the number IS the result (hero figure).
const heroParts = (bar, { pad, u, top, bottom }) => {
  const heroY = top + (bottom - top) * 0.62;
  return [
    text(pad, heroY, bar.display.split(/\s+/)[0], { size: 18 * u, family: VOICE, weight: 400, fill: INK.signal }),
    text(pad, heroY + 5 * u, `${bar.label} · the only arm in this comparison`, { size: 2.4 * u, fill: INK.secondary, spacing: 0.15 * u }),
  ];
};

// The bar block: label column | fixed 0–100% track | value (+ delta) column.
const barParts = (chart, { pad, u, W, H, inner, top, bottom }) => {
  const parts = [];
  const labelSize = 2.5 * u;
  const longest = Math.max(...chart.bars.map((b) => b.label.length), 4);
  const labelW = longest * labelSize * 0.62 + 3 * u;
  const valueW = (chart.deltaHeader ? 30 : 22) * u;
  const x0 = pad + labelW;
  const trackW = inner - labelW - valueW;
  const n = chart.bars.length;
  const slot = Math.min((H > W ? 17 : 10) * u, (bottom - top - 5 * u) / n); // tall cards give the bars the height
  const barH = Math.max(1.2 * u, slot * 0.34);
  for (const q of [0.25, 0.5, 0.75, 1]) {
    const gx = x0 + trackW * q;
    parts.push(`<line x1="${gx}" y1="${top}" x2="${gx}" y2="${top + slot * n}" stroke="${INK.grid}" stroke-width="1"/>`);
  }
  parts.push(`<line x1="${x0}" y1="${top}" x2="${x0}" y2="${top + slot * n}" stroke="${INK.line}" stroke-width="1"/>`);
  chart.bars.forEach((bar, i) => {
    const cy = top + slot * i + slot / 2;
    const len = Math.max(0, Math.min(1, bar.value)) * trackW;
    const gray = chart.ordinal ? LAYER_GRAYS[Math.min(i, LAYER_GRAYS.length - 1)] : LAYER_GRAYS[1];
    parts.push(text(pad, cy + 0.9 * u, bar.label, { size: labelSize, fill: bar.highlight ? INK.primary : INK.secondary, spacing: 0.15 * u }));
    parts.push(`<rect x="${x0}" y="${cy - barH / 2}" width="${len}" height="${barH}" fill="${bar.highlight ? INK.signal : gray}"/>`);
    parts.push(text(x0 + trackW + 2 * u, cy + 0.9 * u, bar.display, { size: 2.7 * u, fill: INK.primary, weight: bar.highlight ? 400 : 300 }));
    if (bar.delta) parts.push(text(W - pad, cy + 0.9 * u, bar.delta, { size: 2.2 * u, fill: INK.tertiary, anchor: 'end' }));
  });
  const axisY = top + slot * n + 2.6 * u;
  for (const q of [0, 0.5, 1]) {
    parts.push(text(x0 + trackW * q, axisY, `${q * 100}%`, { size: 1.8 * u, fill: INK.tertiary, anchor: q === 0 ? 'start' : q === 1 ? 'end' : 'middle' }));
  }
  if (chart.deltaHeader) parts.push(text(W - pad, top - 1.2 * u, chart.deltaHeader, { size: 1.8 * u, fill: INK.tertiary, anchor: 'end' }));
  return parts;
};

/**
 * The card SVG. Geometry scales from the short side so every size keeps the
 * same proportions; bars share the height left between header and footer.
 * Pure.
 * @param {object} chart chartFromSeries/chartFromProof output
 * @param {{size?: string, fontFace?: string}} [options] fontFace = the
 *   <style> block of embedded faces (empty for the browser preview)
 * @returns {{svg: string, width: number, height: number}}
 */
export const renderShareCardSvg = (chart, { size = '16x9', fontFace = '' } = {}) => {
  const { width: W, height: H } = CARD_SIZES[size] ?? CARD_SIZES['16x9'];
  const u = Math.min(W, H) / 100; // one unit = 1% of the short side
  const pad = 7 * u;
  const cut = 3.2 * u;
  const inner = W - pad * 2;
  const parts = [];

  // Frame: chamfered TR + BL, hairline.
  parts.push(`<rect width="${W}" height="${H}" fill="${INK.void}"/>`);
  parts.push(`<path d="M1 1 H${W - cut} L${W - 1} ${cut} V${H - 1} H${cut} L1 ${H - cut} Z" fill="none" stroke="${INK.line}" stroke-width="2"/>`);

  // Header.
  let y = pad + 2.4 * u;
  parts.push(text(pad, y, 'NEUMA BENCH', { size: 2.4 * u, fill: INK.signal, spacing: 0.3 * u }));
  parts.push(text(W - pad, y, chart.date, { size: 2.4 * u, fill: INK.tertiary, anchor: 'end' }));
  y += 7.4 * u;
  parts.push(text(pad, y, fit(chart.title, inner, 6.2 * u, 0.62), { size: 6.2 * u, family: VOICE, weight: 600, fill: INK.primary }));
  y += 4.4 * u;
  parts.push(text(pad, y, fit(chart.subtitle, inner, 2.8 * u, 0.55), { size: 2.8 * u, family: VOICE, fill: INK.secondary }));
  y += 3.8 * u;
  parts.push(text(pad, y, chart.meta, { size: 2.3 * u, fill: INK.tertiary }));

  const footerTop = H - pad - 7.2 * u;
  const body = chart.bars.length === 1
    ? heroParts(chart.bars[0], { pad, u, top: y, bottom: footerTop })
    : barParts(chart, { pad, u, W, H, inner, top: y + 5 * u, bottom: footerTop });
  parts.push(...body);

  // Footer.
  parts.push(`<line x1="${pad}" y1="${footerTop}" x2="${W - pad}" y2="${footerTop}" stroke="${INK.line}" stroke-width="1"/>`);
  parts.push(text(pad, footerTop + 3.6 * u, fit(chart.footnote, inner, 2.2 * u, 0.52), { size: 2.2 * u, family: VOICE, fill: INK.secondary }));
  parts.push(text(pad, footerTop + 6.8 * u, chart.cite, { size: 1.9 * u, fill: INK.tertiary }));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${fontFace}${parts.join('')}</svg>`;
  return { svg, width: W, height: H };
};

/**
 * The chart as a Markdown table — renders on Reddit, GitHub, Discord and
 * most forums, and the numbers stay quotable. Pure.
 */
export const shareMarkdown = (chart) => {
  const head = chart.deltaHeader
    ? `| ${chart.rowHeader} | Score | Δ vs BARE |\n| --- | ---: | ---: |`
    : `| ${chart.rowHeader} | Score |\n| --- | ---: |`;
  const rows = chart.bars.map((b) => {
    const label = b.highlight ? `**${b.label}**` : b.label;
    const score = b.highlight ? `**${b.display.replace(/\s+/g, ' ')}**` : b.display.replace(/\s+/g, ' ');
    return chart.deltaHeader ? `| ${label} | ${score} | ${b.delta ?? '—'} |` : `| ${label} | ${score} |`;
  });
  return [
    `**${chart.title}** — ${[chart.subtitle, chart.meta, chart.date].filter(Boolean).join(' · ')}`,
    '',
    head,
    ...rows,
    '',
    `_${chart.footnote} · ${chart.cite} · measured with NEUMA Bench_`,
    '',
  ].join('\n');
};
