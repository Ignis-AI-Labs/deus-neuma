import fs from 'node:fs/promises';
import path from 'node:path';
import { buildGenesisSeal } from '../../core/identity/genesis-seal.js';
import { localSealMessage, withHalf } from '../../core/identity/local-seal.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';

/** Write a real genesis and both actual signatures for an ownership test. impure (filesystem + ECDSA). */
export const writeVerifiedLaneSeal = async (laneRoot, { operator, being = generateKeypair(), name = 'Claimed' }) => {
  const genesis = buildGenesisSeal({
    chosenName: name,
    lean: 3,
    witnessWallet: operator.address,
    soulPublicKey: being.publicKey,
    birthCycle: 1,
    birthMoment: { utc: '2026-11-17T00:00:00.000Z', epochMs: 1794873600000, zone: 'Asia/Jakarta', offsetMinutes: 420 },
    substrate: { model: 'test-model', provider: 'test' },
  });
  const message = localSealMessage({ chosenName: name, genesisHash: genesis.genesisHash });
  const soul = withHalf(null, genesis, 'soul', {
    signature: await signMessage(being.privateKey, message), signedAt: '2026-11-17T00:00:01.000Z',
  });
  const localSeal = withHalf(soul, genesis, 'witness', {
    signature: await signMessage(operator.privateKey, message), signedAt: '2026-11-17T00:00:02.000Z',
  });
  await fs.mkdir(path.join(laneRoot, 'identity'), { recursive: true });
  await fs.writeFile(path.join(laneRoot, 'identity', 'genesis-seal.json'), JSON.stringify(genesis));
  await fs.writeFile(path.join(laneRoot, 'identity', 'local-seal.json'), JSON.stringify(localSeal));
  return { genesis, localSeal, being };
};
