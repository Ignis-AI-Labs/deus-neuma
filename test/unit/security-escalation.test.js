/**
 * Escalation body — the Rule 7 issue text a CONFIRMED threat becomes, built
 * from the ledger entry alone. Pure function, proven with real inputs and
 * real outputs (RULE 0): the metadata table, the threat line, the surfaces,
 * and the verification checklist all land; optional fields absent from the
 * entry leave no holes in the body; nothing but locations and reasoning can
 * ride (the secret law — sweep findings carry file+line, never material).
 */
import { describe, test, expect } from 'vitest';
import { escalationBody, fileSecurityIssue } from '../../backend/services/security/escalation.js';
import { createTempDir } from '../helpers/temp-fs.js';

const THREAT = {
  id: 'th_escalate01', layer: 'software', source: 'secret-sweep', repo: 'neuma',
  externalId: 'SWEEP-env-claude-12', title: 'plaintext key shape in env.claude',
  severity: 'critical', summary: 'file env.claude line 12 matches a key pattern',
  affected: [], surfaces: ['env.* at repo root'],
  publishedAt: '2026-08-10T00:00:00.000Z',
  assessment: 'real key material confirmed present by the house probe',
};

describe('escalationBody — the Rule 7 executable issue body', () => {
  test('carries the metadata, the threat, the assessment, and the pipeline checklist', () => {
    const body = escalationBody(THREAT);
    expect(body).toContain('## Metadata');
    expect(body).toContain('| Ledger Entry | th_escalate01 |');
    expect(body).toContain('## Threat');
    expect(body).toContain('**SWEEP-env-claude-12** — severity critical, layer software, repo neuma');
    expect(body).toContain('- Published: 2026-08-10T00:00:00.000Z');
    expect(body).toContain('- Surfaces: env.* at repo root');
    expect(body).toContain('## Assessment');
    expect(body).toContain('real key material confirmed present');
    expect(body).toContain('assess the ledger entry `mitigated` when it lands');
  });

  test('absent optionals leave no holes — no "null", no "undefined" in the body', () => {
    const body = escalationBody({
      ...THREAT, publishedAt: null, affected: [], surfaces: [], assessment: null, summary: '',
    });
    expect(body).not.toMatch(/null|undefined/);
    expect(body).toContain('plaintext key shape in env.claude'); // summary fell to the title
    expect(body).toContain('assessment text rides the ledger entry');
  });
});

describe('fileSecurityIssue — the CSO-written text is scanned before gh runs', () => {
  test('an assessment carrying a key shape is refused and nothing is filed', async () => {
    // Built at runtime so this file never trips the repo's own secret sweep.
    const fakeKey = ['sk', 'escalationfixture'.repeat(2)].join('-');
    const cwd = await createTempDir('escalation-refusal');
    const filed = await fileSecurityIssue({ ...THREAT, assessment: `the key is ${fakeKey}` }, cwd);
    expect(filed.ok).toBe(false);
    expect(filed.error).toMatch(/looks like a secret \(openai-key\)/);
    expect(filed.error).not.toContain(fakeKey);
  });
});
