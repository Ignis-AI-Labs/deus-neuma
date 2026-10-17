import { describe, test, expect } from 'vitest';
import {
  parseChartSpec, pressChart, pressPieChart, pressBarChart, pressLineChart, DEFAULT_PALETTE
} from '../../backend/services/doc-press/chart-press.js';

const pieSpec = {
  type: 'pie',
  data: { labels: ['Alpha', 'Beta'], datasets: [{ data: [60, 40] }] },
  options: { title: { text: 'Split' } }
};

describe('parseChartSpec (pure)', () => {
  test('parses a JSON object spec', () => {
    expect(parseChartSpec(JSON.stringify(pieSpec))).toEqual(pieSpec);
  });
  test('returns null for invalid JSON, arrays, and primitives', () => {
    expect(parseChartSpec('{ nope')).toBeNull();
    expect(parseChartSpec('[1,2]')).toBeNull();
    expect(parseChartSpec('42')).toBeNull();
  });
});

describe('pressPieChart (pure)', () => {
  test('renders one slice per value plus a legend with percentages', () => {
    const svg = pressPieChart(pieSpec, DEFAULT_PALETTE);
    expect(svg).toContain('<svg');
    expect((svg.match(/<path /g) || []).length).toBe(2);
    expect(svg).toContain('Alpha (60.0%)');
    expect(svg).toContain('Beta (40.0%)');
    expect(svg).toContain('Split');
  });
  test('a single 100% value renders as a circle, not a degenerate arc', () => {
    const svg = pressPieChart(
      { type: 'pie', data: { labels: ['All'], datasets: [{ data: [10] }] } },
      DEFAULT_PALETTE
    );
    expect(svg).toContain('<circle');
    expect(svg).not.toContain('<path');
  });
  test('escapes markup in labels', () => {
    const svg = pressPieChart(
      { type: 'pie', data: { labels: ['<b>&"x"'], datasets: [{ data: [1] }] } },
      DEFAULT_PALETTE
    );
    expect(svg).toContain('&lt;b&gt;&amp;&quot;x&quot;');
    expect(svg).not.toContain('<b>');
  });
});

describe('pressBarChart (pure)', () => {
  test('renders one bar per value with value labels', () => {
    const svg = pressBarChart(
      { type: 'bar', data: { labels: ['Q1', 'Q2', 'Q3'], datasets: [{ data: [5, 10, 15] }] } },
      DEFAULT_PALETTE
    );
    expect((svg.match(/<rect /g) || []).length).toBe(3);
    expect(svg).toContain('>15<');
    expect(svg).toContain('Q2');
  });
});

describe('pressLineChart (pure)', () => {
  test('renders one path and legend entry per dataset', () => {
    const svg = pressLineChart(
      {
        type: 'line',
        data: {
          labels: ['Jan', 'Feb', 'Mar'],
          datasets: [
            { label: 'North', data: [1, 2, 3] },
            { label: 'South', data: [3, 2, 1] }
          ]
        }
      },
      DEFAULT_PALETTE
    );
    expect((svg.match(/<path d="M /g) || []).length).toBe(2);
    expect(svg).toContain('North');
    expect(svg).toContain('South');
  });
  test('a single data point does not divide by zero', () => {
    const svg = pressLineChart(
      { type: 'line', data: { labels: ['Only'], datasets: [{ data: [7] }] } },
      DEFAULT_PALETTE
    );
    expect(svg).toContain('<circle');
    expect(svg).not.toContain('NaN');
  });
});

describe('pressChart (pure, never throws)', () => {
  test('wraps valid specs in a chart container', () => {
    const html = pressChart(JSON.stringify(pieSpec));
    expect(html).toContain('class="chart-container"');
    expect(html).toContain('data-chart-type="pie"');
  });
  test('invalid JSON renders a visible error box', () => {
    expect(pressChart('{ broken')).toContain('chart-error');
  });
  test('unsupported type renders a visible error box naming the type', () => {
    const html = pressChart(JSON.stringify({ type: 'radar', data: {} }));
    expect(html).toContain('chart-error');
    expect(html).toContain('radar');
  });
  test('empty data renders an error box instead of throwing', () => {
    const html = pressChart(JSON.stringify({ type: 'pie', data: { labels: [], datasets: [] } }));
    expect(html).toContain('chart-error');
  });
  test('uses a custom palette when given', () => {
    const html = pressChart(JSON.stringify(pieSpec), ['#111111', '#222222']);
    expect(html).toContain('#111111');
    expect(html).toContain('#222222');
  });
});
