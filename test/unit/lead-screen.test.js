// THE SCREEN BEFORE A FIRST EMAIL (sales/lead-screen.js): whatever source a lead came from, its company was scored a
// fit for an approved audience and met what that audience requires. Each refusal names the act that moves it. Pure.
import { describe, it, expect } from 'vitest';
import { firstEmailScreen } from '../../backend/services/sales/lead-screen.js';
import { needsFormula } from '../../backend/services/sales/formula-gates.js';

const lead = { id: 'lead-1', name: 'Dana Reyes', contact: 'dana@fundone.example' };
const SIGN = 'its token, project or community is on Base or Robinhood Chain';
const audience = (extra = {}) => ({ id: 's-ua', name: 'Token Projects on Base & Robinhood', state: 'approved', required: [], ...extra });
const scored = (extra = {}) => ({ id: 'p-1', name: 'Fund One', domain: 'fundone.example', match: 3, fit: [{ criterion: 'x', score: 5 }], ...extra });

describe('a first email is written only to a company scored a fit for an approved audience', () => {
  it('a lead under no audience — added by hand, imported, registered from the inbox — is sent to be placed and scored', () => {
    const said = firstEmailScreen({ lead, prospect: null, segment: null });
    expect(said).toMatch(/^Dana Reyes stands under no audience: their company was never scored for one/);
    expect(said).toContain('sales/place {lead: "lead-1", segment}');
    expect(said).toContain('sales/prospect');
  });

  it('a lead put under an audience and never scored for it is sent to be scored, with the audience\'s id', () => {
    const placed = { id: 'placed:lead-1', name: 'Fund One', domain: 'fundone.example', match: 0, fit: [], placed: true };
    const said = firstEmailScreen({ lead, prospect: placed, segment: audience() });
    expect(said).toMatch(/^Fund One's company was put under "Token Projects on Base & Robinhood" and never scored for it — score it now from its own pages: sales\/prospect \{segment: "s-ua"/);
    // With something required, the proofs are asked for in the same filing.
    expect(firstEmailScreen({ lead, prospect: { ...placed, proofs: [{ sign: SIGN, met: true }] }, segment: audience({ required: [{ sign: SIGN, evidence: ['base'], otherwise: null }] }) })).toContain('scores, source, proofs}');
  });

  it('a company scored no match is not written to; one in an audience still waiting for approval waits with it', () => {
    expect(firstEmailScreen({ lead, prospect: scored({ match: 1 }), segment: audience() })).toMatch(/was scored NO MATCH for "Token Projects on Base & Robinhood" — it is not written to for it/);
    expect(firstEmailScreen({ lead, prospect: scored(), segment: audience({ state: 'draft' }) })).toBe('"Token Projects on Base & Robinhood" is draft, not approved — the operator approves an audience before anyone in it is written to');
    expect(firstEmailScreen({ lead, prospect: scored(), segment: audience({ state: 'paused' }) })).toMatch(/is paused, not approved/);
  });

  it('what the audience requires is proved met first; a weak or strong match with it met may be written to', () => {
    const must = audience({ required: [{ sign: SIGN, evidence: ['base'], otherwise: 's-chains' }] });
    expect(firstEmailScreen({ lead, prospect: scored(), segment: must })).toMatch(/was scored before .* required: its token, project or community is on Base or Robinhood Chain — prove it either way/);
    expect(firstEmailScreen({ lead, prospect: scored({ proofs: [{ sign: SIGN, met: false, reasoning: 'on Polygon' }] }), segment: must, segments: [must, { id: 's-chains', name: 'Chain Partnerships' }] })).toMatch(/does NOT meet what .* It belongs to \[s-chains\] "Chain Partnerships": score it there$/);
    expect(firstEmailScreen({ lead, prospect: scored({ proofs: [{ sign: SIGN, met: true }] }), segment: must })).toBeNull();
    expect(firstEmailScreen({ lead, prospect: scored({ match: 2 }), segment: audience() })).toBeNull();
  });
});

describe('what makes an email a first email', () => {
  const buyer = (touches = []) => ({ kind: 'buyer', contact: 'dana@fundone.example', touches });

  it('nothing sent and nothing received: a first email, whatever it is called', () => {
    expect(needsFormula(buyer())).toBe(true);
    expect(needsFormula(buyer(), { followUp: true })).toBe(true); // calling it a follow-up skips no gate
  });

  it('an earlier email on record, or a message from them, makes it a conversation', () => {
    expect(needsFormula(buyer([{ direction: 'out', at: '2026-11-19T00:00:00Z' }]))).toBe(false);
    expect(needsFormula(buyer([{ direction: 'in', at: '2026-11-19T00:00:00Z' }]))).toBe(false);
    expect(needsFormula(null)).toBe(false);
    expect(needsFormula({ ...buyer(), kind: 'partner' })).toBe(false);
  });
});

describe('where the company is', () => {
  const us = audience({ countries: ['US', 'SG'] });
  it('a country simply not known holds nobody; one known to be outside the audience is not written to; a place on the house\'s never-list never is', () => {
    expect(firstEmailScreen({ lead, prospect: scored(), segment: us })).toBeNull();
    expect(firstEmailScreen({ lead, prospect: scored({ country: 'IL' }), segment: audience({ countries: ['US', 'IL'] }), never: ['IL', 'IR'] })).toMatch(/^Fund One is never written to: it is on record in Israel — Israel is on this house's never-list, kept by its legal office, for every campaign$/);
    expect(firstEmailScreen({ lead, prospect: scored({ country: 'IL', placed: true }), segment: us, never: ['IL'] })).toMatch(/is never written to/);
    expect(firstEmailScreen({ lead, prospect: scored({ country: 'IN' }), segment: us })).toBe('Fund One is in IN, and "Token Projects on Base & Robinhood" may only be sent to US, SG — it is not written to for it');
    expect(firstEmailScreen({ lead, prospect: scored({ country: 'SG' }), segment: us })).toBeNull();
  });
  it('a lead the operator placed by hand is not asked for a country', () => {
    expect(firstEmailScreen({ lead, prospect: scored({ placed: true }), segment: us })).toBeNull();
  });
});
