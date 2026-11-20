/**
 * Chart press — renders ```chartjs fenced specs as standalone SVG.
 * Pure functions only: spec in, markup out. No Chart.js runtime, no DOM.
 *
 * Supported spec shape (Chart.js-compatible subset):
 *   { "type": "pie"|"bar"|"line", "data": { "labels": [], "datasets": [] },
 *     "options": { "title": { "text": "..." } } }
 */

import { escapeMarkup } from './text-escape.js';

export const DEFAULT_PALETTE = Object.freeze([
  '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
  '#FF9F40', '#C9CBCF', '#7CB342', '#E7E9ED', '#D81B60'
]);

const FONT = 'Arial, sans-serif';

/**
 * Parses a chartjs fence body into a spec object.
 * @param {string} source
 * @returns {object|null} - null when the body is not a JSON object
 */
export function parseChartSpec(source) {
  try {
    const spec = JSON.parse(String(source).trim());
    return spec && typeof spec === 'object' && !Array.isArray(spec) ? spec : null;
  } catch {
    return null;
  }
}

function chartErrorBox(message) {
  return `<div class="chart-error">${escapeMarkup(message)}</div>`;
}

function paletteColor(palette, index) {
  return palette[index % palette.length];
}

function specTitle(spec) {
  return spec.options?.title?.text || spec.options?.plugins?.title?.text || '';
}

function titleText(title, x) {
  if (!title) return '';
  return `<text x="${x}" y="30" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="bold">${escapeMarkup(title)}</text>`;
}

function extractSeries(spec) {
  const labels = Array.isArray(spec.data?.labels) ? spec.data.labels : [];
  const datasets = Array.isArray(spec.data?.datasets) ? spec.data.datasets : [];
  if (labels.length === 0 || datasets.length === 0) {
    throw new Error('chart spec has no labels or datasets');
  }
  return { labels, datasets };
}

// A chart scales to the page: with a viewBox the stylesheet's `max-width: 100%; height: auto` shrinks
// it to the printable width; without one an 800 px chart was cropped on every paper size (#33). Pure.
const svgOpen = (width, height) => `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`;

function datasetColors(dataset, palette) {
  const declared = dataset.backgroundColor;
  if (Array.isArray(declared) && declared.length > 0) return declared;
  if (typeof declared === 'string') return [declared];
  return palette;
}

/**
 * Renders a pie chart as SVG. Pure.
 */
export function pressPieChart(spec, palette) {
  const { labels, datasets } = extractSeries(spec);
  const values = datasets[0].data || [];
  const colors = datasetColors(datasets[0], palette);
  const total = values.reduce((sum, v) => sum + Number(v || 0), 0);
  if (total <= 0) throw new Error('pie chart values sum to zero');

  const maxLabelLength = Math.max(...labels.map((l) => String(l).length));
  const width = Math.max(800, 600 + maxLabelLength * 8);
  const centerX = 250;
  const centerY = 200;
  const radius = 150;
  const legendX = centerX + radius + 80;

  const parts = [svgOpen(width, 400)];
  parts.push(titleText(specTitle(spec), width / 2));
  // A pie shows one dataset; the others are named on the chart, never dropped without a word (#33).
  if (datasets.length > 1) {
    parts.push(`<text x="${width / 2}" y="${46}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#888">showing ${escapeMarkup(datasets[0].label || 'the first dataset')} — ${datasets.length - 1} more dataset${datasets.length > 2 ? 's' : ''} not drawn (a pie shows one)</text>`);
  }

  let angle = -Math.PI / 2;
  values.forEach((value, index) => {
    const share = Number(value || 0) / total;
    const color = paletteColor(colors, index);
    // A full-circle arc collapses to nothing in SVG path syntax — draw a circle instead.
    if (share >= 1) {
      parts.push(`<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="${escapeMarkup(color)}" stroke="white" stroke-width="2"/>`);
      return;
    }
    const sweep = share * 2 * Math.PI;
    const x1 = centerX + radius * Math.cos(angle);
    const y1 = centerY + radius * Math.sin(angle);
    const x2 = centerX + radius * Math.cos(angle + sweep);
    const y2 = centerY + radius * Math.sin(angle + sweep);
    const largeArc = sweep > Math.PI ? 1 : 0;
    parts.push(`<path d="M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${escapeMarkup(color)}" stroke="white" stroke-width="2"/>`);
    angle += sweep;
  });

  labels.forEach((label, index) => {
    const y = 60 + index * 22;
    const pct = ((Number(values[index] || 0) / total) * 100).toFixed(1);
    parts.push(`<rect x="${legendX}" y="${y - 8}" width="12" height="12" fill="${escapeMarkup(paletteColor(colors, index))}"/>`);
    parts.push(`<text x="${legendX + 20}" y="${y + 2}" font-family="${FONT}" font-size="11" fill="#333">${escapeMarkup(label)} (${pct}%)</text>`);
  });

  parts.push('</svg>');
  return parts.join('');
}

/**
 * Renders a bar chart as SVG. Pure.
 */
export function pressBarChart(spec, palette) {
  const { labels, datasets } = extractSeries(spec);
  // Every dataset is drawn, grouped side by side under its label, each in its own colour with a
  // legend (#33: only the first dataset was drawn). One dataset keeps a colour per bar, as before.
  const grouped = datasets.length > 1;
  const values = datasets[0].data || [];
  const colors = datasetColors(datasets[0], palette);
  const seriesColor = (dataset, index) => paletteColor(datasetColors(dataset, palette), grouped && !dataset.backgroundColor ? index : 0);

  const width = 800;
  const height = 500;
  const pad = { top: 80, right: 60, bottom: 100, left: 100 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(...datasets.flatMap((d) => (d.data || []).map((v) => Number(v || 0)))) * 1.1;
  if (!(maxValue > 0)) throw new Error('bar chart has no positive values');

  const parts = [svgOpen(width, height)];
  parts.push(titleText(specTitle(spec), width / 2));
  parts.push(`<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#333" stroke-width="2"/>`);
  parts.push(`<line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#333" stroke-width="2"/>`);

  for (let i = 0; i <= 5; i++) {
    const y = height - pad.bottom - (i / 5) * chartHeight;
    parts.push(`<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e0e0e0" stroke-width="1"/>`);
    parts.push(`<text x="${pad.left - 15}" y="${y + 4}" text-anchor="end" font-family="${FONT}" font-size="12" fill="#666">${((i / 5) * maxValue).toFixed(0)}</text>`);
  }

  const slot = chartWidth / labels.length;
  const groupWidth = slot * 0.7;
  const barWidth = groupWidth / datasets.length;
  datasets.forEach((dataset, d) => {
    (grouped ? (dataset.data || []) : values).forEach((value, index) => {
      const v = Number(value || 0);
      const x = pad.left + index * slot + (slot - groupWidth) / 2 + d * barWidth;
      const barHeight = (v / maxValue) * chartHeight;
      const y = height - pad.bottom - barHeight;
      const fill = grouped ? seriesColor(dataset, d) : paletteColor(colors, index);
      parts.push(`<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${escapeMarkup(fill)}" stroke="white" stroke-width="1"/>`);
      parts.push(`<text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" font-family="${FONT}" font-size="${grouped ? 9 : 11}" fill="#333" font-weight="bold">${escapeMarkup(v)}</text>`);
    });
  });
  if (grouped) {
    datasets.forEach((dataset, d) => {
      const x = pad.left + d * 140;
      parts.push(`<rect x="${x}" y="${height - 40}" width="12" height="12" fill="${escapeMarkup(seriesColor(dataset, d))}"/>`);
      parts.push(`<text x="${x + 18}" y="${height - 30}" font-family="${FONT}" font-size="11" fill="#333">${escapeMarkup(dataset.label || `series ${d + 1}`)}</text>`);
    });
  }

  labels.forEach((label, index) => {
    const x = pad.left + index * slot + slot / 2;
    parts.push(`<text x="${x}" y="${height - pad.bottom + 25}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="#666">${escapeMarkup(label)}</text>`);
  });

  parts.push('</svg>');
  return parts.join('');
}

/**
 * Renders a line chart as SVG (multi-dataset). Pure.
 */
export function pressLineChart(spec, palette) {
  const { labels, datasets } = extractSeries(spec);

  const width = 800;
  const height = 400;
  const pad = { top: 60, right: 50, bottom: 100, left: 80 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;

  const all = datasets.flatMap((d) => (d.data || []).map((v) => Number(v || 0)));
  if (all.length === 0) throw new Error('line chart has no data points');
  const dataMin = Math.min(...all);
  const dataMax = Math.max(...all);
  const beginAtZero = dataMin >= 0 && spec.options?.scales?.yAxes?.[0]?.ticks?.beginAtZero !== false;
  const scaleMin = beginAtZero ? 0 : dataMin - (dataMax - dataMin) * 0.1;
  const scaleMax = dataMax + (dataMax - dataMin || Math.abs(dataMax) || 1) * 0.1;
  const scaleRange = scaleMax - scaleMin || 1;

  const xAt = (index) => labels.length === 1
    ? pad.left + chartWidth / 2
    : pad.left + (index / (labels.length - 1)) * chartWidth;
  const yAt = (value) => height - pad.bottom - ((value - scaleMin) / scaleRange) * chartHeight;

  const parts = [svgOpen(width, height)];
  parts.push(titleText(specTitle(spec), width / 2));
  parts.push(`<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#333" stroke-width="2"/>`);
  parts.push(`<line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#333" stroke-width="2"/>`);

  for (let i = 0; i <= 5; i++) {
    const y = height - pad.bottom - (i / 5) * chartHeight;
    const value = scaleMin + (i / 5) * scaleRange;
    parts.push(`<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e0e0e0" stroke-width="1"/>`);
    parts.push(`<text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" font-family="${FONT}" font-size="12" fill="#666">${value.toFixed(2)}</text>`);
  }

  datasets.forEach((dataset, datasetIndex) => {
    const color = dataset.borderColor || paletteColor(palette, datasetIndex);
    const points = (dataset.data || []).map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(Number(v || 0))}`);
    parts.push(`<path d="${points.join(' ')}" fill="none" stroke="${escapeMarkup(color)}" stroke-width="2"/>`);
    (dataset.data || []).forEach((v, i) => {
      parts.push(`<circle cx="${xAt(i)}" cy="${yAt(Number(v || 0))}" r="4" fill="${escapeMarkup(color)}"/>`);
    });
    const legendX = pad.left + datasetIndex * 150;
    parts.push(`<line x1="${legendX}" y1="${pad.top - 20}" x2="${legendX + 20}" y2="${pad.top - 20}" stroke="${escapeMarkup(color)}" stroke-width="2"/>`);
    parts.push(`<text x="${legendX + 25}" y="${pad.top - 16}" font-family="${FONT}" font-size="12">${escapeMarkup(dataset.label || `Dataset ${datasetIndex + 1}`)}</text>`);
  });

  labels.forEach((label, index) => {
    parts.push(`<text x="${xAt(index)}" y="${height - pad.bottom + 25}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="#666">${escapeMarkup(label)}</text>`);
  });

  parts.push('</svg>');
  return parts.join('');
}

const RENDERERS = Object.freeze({
  pie: pressPieChart,
  bar: pressBarChart,
  line: pressLineChart
});

/**
 * Converts a chartjs fence body into embeddable chart HTML.
 * Invalid specs render as a visible error box, never throw. Pure.
 * @param {string} source - Fence body (JSON spec)
 * @param {readonly string[]} [palette] - Brand palette override
 * @returns {string}
 */
export function pressChart(source, palette = DEFAULT_PALETTE) {
  const spec = parseChartSpec(source);
  if (!spec || typeof spec.type !== 'string') {
    return chartErrorBox('Invalid chart specification (expected a JSON object with a "type")');
  }
  const render = RENDERERS[spec.type.toLowerCase()];
  if (!render) {
    return chartErrorBox(`Unsupported chart type: ${spec.type}`);
  }
  try {
    const svg = render(spec, palette);
    return `<div class="chart-container" data-chart-type="${escapeMarkup(spec.type.toLowerCase())}">${svg}</div>`;
  } catch (err) {
    return chartErrorBox(`Chart rendering failed: ${err.message}`);
  }
}
