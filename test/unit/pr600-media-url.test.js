import { describe, expect, it } from 'vitest';
import { safeMediaUrl } from '../../frontend/app/RelinkShell/media-url.js';

describe('P6-150 persisted media URL gate', () => {
  it('keeps legitimate media sources', () => {
    for (const src of ['/api/v1/gallery/file?rootId=a&rel=b', 'https://example.com/a.png', 'http://localhost/a.mp4', 'blob:https://neuma.local/id', 'data:image/png;base64,AA==', 'data:video/mp4;base64,AA==']) {
      expect(safeMediaUrl(src)).toBe(src);
    }
  });

  it('refuses script, local-file, HTML-data, network-path and control forms', () => {
    for (const src of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<script>alert(1)</script>', 'data:image/svg+xml,<svg onload=alert(1)>', '//attacker/x', '/ok\njavascript:alert(1)', 'relative.png', null, 42]) {
      expect(safeMediaUrl(src)).toBeNull();
    }
  });
});
