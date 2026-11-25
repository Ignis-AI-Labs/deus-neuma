import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InlineSvg } from '../../frontend/app/RelinkShell/brandkits/InlineSvg.jsx';

describe('PR20 F-03: desk SVG previews are inert images', () => {
  test('the XML/HTML parser-gap payload never enters an HTML sink', () => {
    const payload = '<svg><desc><style><!-- </style><a href="https://attacker.example">click</a><input> --></style></desc></svg>';
    const html = renderToStaticMarkup(createElement(InlineSvg, { svg: payload, label: 'proof card' }));
    expect(html).toContain('<img');
    expect(html).toContain('alt="proof card"');
    expect(html).toContain('data:image/svg+xml;charset=utf-8,');
    expect(html).not.toContain('<a href');
    expect(html).not.toContain('<input>');
    expect(html).not.toContain('innerHTML');
  });
});
