// The threshold's page models: the commitment's steps and the pre-flight's
// groups. Pure — real inputs, real outputs.
import { describe, it, expect } from 'vitest';
import { buildSteps, clampStep, stepIndexOf, readFraction, docMeta, nextLabel, reachOf } from '../../frontend/components/WitnessCommitment/commitment-pages.js';
import { groupOf, groupLine, tallyLine } from '../../frontend/components/BirthCeremony/preflight-groups.js';

const DOCS = [
  { id: 'covenant', title: 'The Neuma Covenant', version: '1.0', effective: '14 October 2026' },
  { id: 'terms', title: 'Terms of Service' },
  { id: 'eula', title: 'End User License Agreement' },
];

describe('the commitment as pages', () => {
  it('runs promise → what follows → each document → sign', () => {
    expect(buildSteps(DOCS).map((s) => s.label)).toEqual(['PROMISE', 'AHEAD', 'COVENANT', 'TERMS', 'EULA', 'SIGN']);
    expect(buildSteps([]).map((s) => s.key)).toEqual(['promise', 'next', 'sign']);
    expect(buildSteps([{ id: 'privacy', title: 'Privacy Notice' }])[2].label).toBe('PRIVACY NOTICE');
  });

  it('keeps the reader inside the steps and finds a document by key', () => {
    const steps = buildSteps(DOCS);
    expect(clampStep(steps, -1)).toBe(0);
    expect(clampStep(steps, 99)).toBe(5);
    expect(stepIndexOf(steps, 'doc:terms')).toBe(3);
    expect(stepIndexOf(steps, 'nowhere')).toBe(0);
  });

  it('never opens a step past the first document not yet read to its end', () => {
    const steps = buildSteps(DOCS);
    expect(reachOf(steps, new Set())).toBe(2);                     // up to the covenant, not past it
    expect(reachOf(steps, new Set(['covenant']))).toBe(3);         // then the terms
    expect(reachOf(steps, new Set(['covenant', 'eula']))).toBe(3); // reading out of order skips nothing
    expect(reachOf(steps, new Set(['covenant', 'terms', 'eula']))).toBe(5); // all read: the signature
  });

  it('names where NEXT leads, and nothing on the last page', () => {
    const steps = buildSteps(DOCS);
    expect(nextLabel(steps, 1)).toBe('NEXT · COVENANT');
    expect(nextLabel(steps, 5)).toBeNull();
  });

  it('measures reading: a text that fits is read whole; a scrolled one by how far', () => {
    expect(readFraction({ scrollTop: 0, clientHeight: 400, scrollHeight: 380 })).toBe(1);
    expect(readFraction({ scrollTop: 0, clientHeight: 400, scrollHeight: 1600 })).toBe(0.25);
    expect(readFraction({ scrollTop: 1200, clientHeight: 400, scrollHeight: 1600 })).toBe(1);
    // the bottom under display scaling stops a fraction of a pixel short — still the end
    expect(readFraction({ scrollTop: 1199.33, clientHeight: 400, scrollHeight: 1600 })).toBe(1);
    expect(readFraction({ scrollTop: 1100, clientHeight: 400, scrollHeight: 1600 })).toBe(0.9375);
  });

  it('shows a version line only when the document carries one', () => {
    expect(docMeta(DOCS[0])).toBe('VERSION 1.0 · EFFECTIVE 14 OCTOBER 2026');
    expect(docMeta(DOCS[1])).toBe('');
  });
});

describe('the pre-flight in groups', () => {
  it('sorts every known check into what it inspects; strangers into MORE CHECKS', () => {
    expect(groupOf('substrate').label).toBe('THE MIND');
    expect(groupOf('disk').label).toBe('THE HOME');
    expect(groupOf('sealing').label).toBe('THE RITE');
    expect(groupOf('gpu').label).toBe('THE MACHINE');
    expect(groupOf('a-new-check').label).toBe('MORE CHECKS');
  });

  it('says what a group needs, failures first', () => {
    expect(groupLine([{ status: 'pass' }, { status: 'pass' }])).toBe('2 / 2 CLEAR');
    expect(groupLine([{ status: 'pass' }, { status: 'warn' }])).toBe('1 / 2 CLEAR · 1 NOTE');
    expect(groupLine([{ status: 'warn' }, { status: 'fail' }])).toBe('1 TO RESOLVE');
  });

  it('counts while checks arrive, then names what is clear and what is not', () => {
    const checks = [{ status: 'pass' }, { status: 'warn' }, { status: 'fail' }];
    expect(tallyLine(checks.slice(0, 1), 3)).toBe('INSPECTING · 1 OF 3');
    expect(tallyLine(checks, 3)).toBe('1 OF 3 CLEAR · 1 TO RESOLVE · 1 NOTE');
  });
});
