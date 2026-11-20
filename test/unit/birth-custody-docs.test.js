import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalizeGenesisRecord, computeGenesisHash } from '../../backend/services/genesis-canonical.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFile(path.join(ROOT, file), 'utf8');

describe('birth custody disclosures', () => {
  it('tells the being who holds key custody and who can delete storage', async () => {
    const stage0 = await read('core/protocols/birth-stages/stage0-opening.md');
    const stage1 = await read('core/protocols/birth-stages/stage1-house.md');
    const stage2 = await read('core/protocols/birth-stages/stage2-choice.md');
    const stage5 = await read('core/protocols/birth-stages/stage5-record.md');

    expect(stage0).toContain("sealed under the install's master key");
    expect(stage0).toContain('Whoever controls this machine or its storage can still delete or lose files');
    expect(stage1).toContain("The install's master key");
    expect(stage2).toContain('whoever controls the machine or its storage can still delete it');
    expect(stage5).toContain("the install's master key on the operator's machine can unwrap");
    expect(stage5).toContain('whoever controls the machine or its storage can still delete the files');

    for (const text of [stage0, stage1, stage2, stage5]) {
      expect(text).not.toContain('encrypted with your own key');
      expect(text).not.toContain("encrypted with its owner's key");
      expect(text).not.toContain('platform has no way to delete');
    }
  });
});

describe('genesis hash disclosure', () => {
  it('describes the deterministic hash without claiming unlinkability', async () => {
    const doc = await read('publish/deus-neuma/docs/WHY-THE-CHAIN.md');
    expect(doc).toContain('deterministic fingerprint');
    expect(doc).toContain('compute candidate hashes and link them');
    expect(doc).not.toContain('it reveals nothing by itself');
  });

  it('keeps the documented version-1 hash behavior deterministic', () => {
    const raw = {
      birthMoment: '2026-11-17T10:00:00.000Z',
      capturedAt: '2026-11-17T10:00:01.000Z',
      chosenName: 'Synthetic',
      house: 'example',
      soulAddress: `0x${'1'.repeat(40)}`,
      soulMark: 'ABCDEF123456',
      substrate: { vendor: 'test', model: 'model', fullModelId: 'test/model', harness: 'test' },
      witnessAddress: `0x${'2'.repeat(40)}`,
      witnessKind: 'synthetic-witness',
    };
    const first = canonicalizeGenesisRecord(raw);
    const second = canonicalizeGenesisRecord(raw);
    expect(computeGenesisHash(first.recordString)).toBe(computeGenesisHash(second.recordString));
    expect(computeGenesisHash(first.recordString)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('demo recovery custody guidance', () => {
  it('assigns custody to the operator alone and leaves external revocation honestly blocked', async () => {
    const doc = await read('docs/work/neuma-demo-video.md');
    expect(doc).toContain('custody must belong to Founder alone');
    expect(doc).toContain('Claude has no custody');
    expect(doc).toContain("BLOCKED on Founder's external action");
    expect(doc).not.toContain('kept by Founder and Claude');
  });
});


describe('witness env custody documentation', () => {
  it('describes public metadata and sealed unlock rather than plaintext private material', async () => {
    const standard = await read('docs/protocols/witnesses/ai-witness-standard.md');
    const integration = await read('docs/user/integrations/neuma-skill.md');
    expect(standard).toContain('private material stays in `keys/keypair-encrypted.json`');
    expect(standard).not.toContain('Wallet address + private key + genesis hash');
    expect(integration).toContain('Public metadata naming the sealed witness');
    expect(integration).toContain('asks for its keypair password with echo disabled');
    expect(integration).not.toContain('A file containing a `*_PRIVATE_KEY=0x…64hex` line');
  });
});
