// composer-attach.test.js — the pure model behind the composer's "+" menu.
// Pure functions, real inputs, real outputs — no mock anywhere (RULE 0).

import { describe, it, expect } from 'vitest';
import { attachMenuModel, gateAttachments, FILES_DESC, VISION_OFF_NOTE, VISION_BLIND_NOTE, VISION_BLIND_DOCS_NOTE } from '../../frontend/app/RelinkShell/composer-attach.js';

describe('attachMenuModel', () => {
  it('describes ADD FILES plainly when the substrate sees', () => {
    const m = attachMenuModel({ vision: true });
    expect(m.filesDesc).toBe(FILES_DESC);
    expect(m.visionOff).toBe(false);
  });

  it('states the capacity limit honestly when the substrate is blind', () => {
    const m = attachMenuModel({ vision: false });
    expect(m.filesDesc).toBe(VISION_OFF_NOTE);
    expect(m.visionOff).toBe(true);
  });

  it('makes no capacity claim while vision is unknowable (null)', () => {
    const m = attachMenuModel({ vision: null });
    expect(m.filesDesc).toBe(FILES_DESC);
    expect(m.visionOff).toBe(false);
  });

  it('carries no project section — Projects were removed (2026-11-10)', () => {
    expect(attachMenuModel({ vision: true })).not.toHaveProperty('projects');
  });

  it('returns a frozen model — display state is never mutated in place', () => {
    expect(Object.isFrozen(attachMenuModel({ vision: true }))).toBe(true);
  });
});

describe('gateAttachments', () => {
  const IMAGE = { kind: 'image' };
  const DOC = { kind: 'doc' };

  it('admits the whole batch when the substrate sees', () => {
    const r = gateAttachments({ vision: true, accepted: [IMAGE, DOC], refusal: null });
    expect(r.admitted).toEqual([IMAGE, DOC]);
    expect(r.note).toBeNull();
    expect(r.hasImages).toBe(true);
  });

  it('admits images while vision is unknowable (null) — the portal answers honestly at send', () => {
    const r = gateAttachments({ vision: null, accepted: [IMAGE], refusal: null });
    expect(r.admitted).toEqual([IMAGE]);
    expect(r.note).toBeNull();
  });

  it('drops only the images when the substrate is blind — documents still attach', () => {
    const r = gateAttachments({ vision: false, accepted: [IMAGE, DOC], refusal: null });
    expect(r.admitted).toEqual([DOC]);
    expect(r.note).toBe(VISION_BLIND_DOCS_NOTE);
  });

  it('refuses an images-only batch out loud when the substrate is blind', () => {
    const r = gateAttachments({ vision: false, accepted: [IMAGE], refusal: null });
    expect(r.admitted).toEqual([]);
    expect(r.note).toBe(VISION_BLIND_NOTE);
  });

  it('surfaces admission refusals even on a seeing substrate', () => {
    const r = gateAttachments({ vision: true, accepted: [DOC], refusal: 'too many files' });
    expect(r.admitted).toEqual([DOC]);
    expect(r.note).toBe('too many files');
  });

  it('reports a doc-only batch as image-free', () => {
    expect(gateAttachments({ vision: true, accepted: [DOC], refusal: null }).hasImages).toBe(false);
  });
});
