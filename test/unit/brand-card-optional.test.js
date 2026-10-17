/** Real pure SVG substitution: absent optional data never remains template text. */
import { describe, expect, it } from 'vitest';
import { renderCardSvg } from '../../backend/services/branding/card-svg.js';

const spec = { fields: { title: { required: true }, about: { required: false } } };
const template = '<svg><text>{{data.title}}</text><text>{{data.about}}</text></svg>';
describe('optional card fields', () => {
  it.each([undefined, null])('renders an absent optional field as empty text (%s)', (about) => {
    const result = renderCardSvg(template, { spec, data: { title: 'A & B', about } });
    expect(result).toEqual({ ok: true, svg: '<svg><text>A &amp; B</text><text></text></svg>' });
  });
  it('still refuses an absent required field', () => {
    expect(renderCardSvg(template, { spec, data: {} }).ok).toBe(false);
  });
  it('still refuses an undeclared data placeholder', () => {
    expect(renderCardSvg('<svg>{{data.typo}}</svg>', { spec, data: { title: 'A' } }).ok).toBe(false);
  });
  it('still refuses missing non-data namespaces', () => {
    expect(renderCardSvg('<svg>{{mark.typo}}</svg>', { spec, data: { title: 'A' } }).ok).toBe(false);
  });
});
