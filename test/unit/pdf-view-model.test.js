/**
 * The reader's pure law — page clamps, zoom reach, instrument labels.
 */
import { describe, it, expect } from 'vitest';
import { clampPage, stepZoom, zoomLabel, pageLabel, ZOOM_MIN, ZOOM_MAX } from '../../frontend/app/RelinkShell/files/pdf-view-model.js';

describe('clampPage', () => {
  it('holds inside the document, clamps at both edges', () => {
    expect(clampPage(1, 14)).toBe(1);
    expect(clampPage(7, 14)).toBe(7);
    expect(clampPage(0, 14)).toBe(1);
    expect(clampPage(-3, 14)).toBe(1);
    expect(clampPage(15, 14)).toBe(14);
    expect(clampPage(999, 14)).toBe(14);
  });

  it('an unloaded document holds page 1 — nothing to navigate', () => {
    expect(clampPage(5, 0)).toBe(1);
    expect(clampPage(1, 0)).toBe(1);
  });

  it('junk reads as the first page, never as a crash', () => {
    expect(clampPage('x', 4)).toBe(1);
    expect(clampPage(2.7, 4)).toBe(2);
    expect(clampPage(null, 4)).toBe(1);
  });
});

describe('stepZoom', () => {
  it('steps multiply, clamped to the honest reach', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.8);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(stepZoom(3.9, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(0.27, -1)).toBe(ZOOM_MIN);
  });
});

describe('the instrument labels', () => {
  it('zoom reads as a percent', () => {
    expect(zoomLabel(1)).toBe('100%');
    expect(zoomLabel(0.8)).toBe('80%');
    expect(zoomLabel(1.25)).toBe('125%');
  });

  it('the page reads current / total, clamped', () => {
    expect(pageLabel(2, 14)).toBe('2 / 14');
    expect(pageLabel(99, 14)).toBe('14 / 14');
    expect(pageLabel(1, 0)).toBe('1 / 1');
  });
});
