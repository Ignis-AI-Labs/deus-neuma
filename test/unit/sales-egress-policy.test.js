import { describe, expect, test } from 'vitest';
import { salesEmailIntents } from '../../backend/services/intents/sales-email-acts.js';
import { salesProveIntents } from '../../backend/services/intents/sales-prove-acts.js';
import { salesIntents } from '../../backend/services/intents/sales-acts.js';

const intent = (list, name) => list.find((entry) => entry.name === name);

describe('PR20 H-03: every proof-bearing sales act uses the web approval row', () => {
  test('entity and prove use web.fetch', () => {
    expect(intent(salesEmailIntents, 'sales/entity').policyTool).toBe('web.fetch');
    expect(intent(salesProveIntents, 'sales/prove').policyTool).toBe('web.fetch');
  });

  test('prospect selects web.fetch only when execution will verify evidence', () => {
    const prospect = intent(salesIntents, 'sales/prospect');
    expect(prospect.policyToolFor({ companies: [{ domain: 'plain.example' }] })).toBe('sales.prospect');
    expect(prospect.policyToolFor({ companies: [{ proofs: [{ met: false }] }] })).toBe('sales.prospect');
    expect(prospect.policyToolFor({ companies: [{ proofs: [{ met: true }] }] })).toBe('web.fetch');
    expect(prospect.policyToolFor({ companies: [{ entityEvidence: { quote: 'proof' } }] })).toBe('web.fetch');
  });
});
