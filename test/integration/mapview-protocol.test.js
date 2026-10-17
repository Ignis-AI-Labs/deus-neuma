/**
 * MEASURED protocol law (MAPVIEW-012, #392), proven against real repos on
 * disk (RULE 0, no mocks). The contract under test is sovereignty-shaped:
 *
 *   - a rule fires ONLY when it stands in `protocol.rules` WITH a signature;
 *   - an unsigned row — even one placed inside protocol.rules — is inert;
 *   - `protocolProposed` never fires, however complete its rows look;
 *   - patterns match MASKED text, so a doctrine comment QUOTING a banned
 *     token can never raise a finding;
 *   - scope is honored (appliesTo prefixes, excludePaths), test files are in
 *     reach (the Rule-0 floor targets test/integration), and findings ride
 *     the ordinary baseline/delta pipeline like every other anomaly.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { scanArchitecture } from '../../backend/services/mapview/scan.js';
import { buildBaseline, diffAgainstBaseline } from '../../backend/services/mapview/delta.js';

let root;
let graph;

const write = async (rel, text) => {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text);
};

const protocolFindings = (g) => g.anomalies.filter((a) => a.kind === 'protocol');

beforeAll(async () => {
  root = await createTempDir('mapview-protocol');
  await write('package.json', JSON.stringify({ name: 'fixture', type: 'module' }));
  await write('mapview.config.json', JSON.stringify({
    entryPoints: ['entry.js'],
    protocol: {
      rules: [
        {
          id: 'no-typescript',
          signedBy: 'Fixture Operator, 2026-08-20',
          reason: 'Repo law: no TypeScript.',
          appliesTo: [''],
          excludePaths: ['vendor'],
          forbidExtensions: ['.ts', '.tsx'],
        },
        {
          id: 'no-mocks-in-integration',
          signedBy: 'Fixture Operator, 2026-08-20',
          reason: 'Rule 0 floor.',
          appliesTo: ['test/integration'],
          forbidPattern: '\\bvi\\.(mock|doMock|fn|spyOn)\\s*\\(',
        },
        {
          // NO signedBy — must be inert even though it sits in protocol.rules.
          id: 'unsigned-ban',
          reason: 'Nobody signed this.',
          appliesTo: [''],
          forbidPattern: 'perfectlyOrdinaryToken',
        },
      ],
    },
    protocolProposed: {
      rules: [{
        id: 'proposed-ban', signedBy: 'looks signed but lives in the inbox',
        reason: 'Proposals never fire.', appliesTo: [''], forbidPattern: 'anotherOrdinaryToken',
      }],
    },
  }));

  await write('entry.js', "import { ok } from './lib.js';\nok();\nconst perfectlyOrdinaryToken = 1;\nconst anotherOrdinaryToken = perfectlyOrdinaryToken;\n");
  await write('lib.js', 'export const ok = () => 1;\n');
  await write('rogue.ts', 'export const t: number = 1;\n');
  await write('vendor/allowed.ts', 'export const v: number = 2;\n');
  // The banned token in CODE (fires) vs quoted in a COMMENT (never fires).
  await write('test/integration/mocked.test.js', "vi.mock('../lib.js');\nexport const x = 1;\n");
  await write('test/integration/doctrine.test.js', "// The old suite used vi.mock('../lib.js') — never again.\nexport const y = 1;\n");
  // Same token OUTSIDE the rule's scope — out of reach.
  await write('scripts/uses-vi.js', "vi.mock('../lib.js');\n");

  graph = await scanArchitecture(root);
});

describe('signed rules fire', () => {
  it('a banned extension in scope is a protocol finding; the excluded path is not', () => {
    const labels = protocolFindings(graph).map((a) => a.label);
    expect(labels).toContain('no-typescript rogue.ts');
    expect(labels.some((l) => l.includes('vendor/allowed.ts'))).toBe(false);
  });

  it('a banned token in a TEST file is in reach, and carries the signature in its detail', () => {
    const hit = protocolFindings(graph).find((a) => a.label === 'no-mocks-in-integration test/integration/mocked.test.js');
    expect(hit).toBeDefined();
    expect(hit.detail).toContain('signed: Fixture Operator');
  });

  it('scope is honored — the same token outside appliesTo raises nothing', () => {
    expect(protocolFindings(graph).some((a) => a.files.includes('scripts/uses-vi.js'))).toBe(false);
  });
});

describe('unsigned law does nothing', () => {
  it('an unsigned row inside protocol.rules is inert', () => {
    expect(protocolFindings(graph).some((a) => a.label.startsWith('unsigned-ban'))).toBe(false);
  });

  it('protocolProposed rows never fire, however signed they look', () => {
    expect(protocolFindings(graph).some((a) => a.label.startsWith('proposed-ban'))).toBe(false);
  });
});

describe('honest matching and the ordinary pipeline', () => {
  it('a comment QUOTING the banned token never fires (masked text)', () => {
    expect(protocolFindings(graph).some((a) => a.files.includes('test/integration/doctrine.test.js'))).toBe(false);
  });

  it('protocol findings baseline and delta like every other anomaly', () => {
    const baseline = buildBaseline(graph);
    const clean = diffAgainstBaseline(graph, baseline);
    expect(clean.introduced).toEqual([]);
    // A fresh violation after the baseline reads as INTRODUCED.
    const withNew = {
      ...graph,
      anomalies: graph.anomalies.concat([{
        kind: 'protocol', severity: 'warn', label: 'no-typescript fresh.ts', files: ['fresh.ts'], detail: 'Repo law: no TypeScript. (signed: Fixture Operator, 2026-08-20)',
      }]),
    };
    const dirty = diffAgainstBaseline(withNew, baseline);
    expect(dirty.introduced.map((a) => a.label)).toContain('no-typescript fresh.ts');
  });
});
