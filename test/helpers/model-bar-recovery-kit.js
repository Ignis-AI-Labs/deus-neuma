import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Wallet } from 'ethers';

/** Isolated real inference routes with an offline engine; no completion substitute. Impure. */
export const mountRecoveryRoutes = async (app, root, url) => {
  const env = {
    NEUMA_DATA_ROOT: root,
    NEUMA_ROUTES_PATH: path.join(root, 'routes.json'),
    NEUMA_EFFORT_PATH: path.join(root, 'effort.json'),
    NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(root, 'credentials.json'),
    NEUMA_MODEL_FOLDERS_PATH: path.join(root, 'folders.json'),
    NEUMA_SUBSTRATE_CLAIM_DIR: path.join(root, 'claims'),
    WORKSPACES_ROOT: path.join(root, 'workspaces'),
    NEUMA_MODELS_DIRS: path.join(root, 'models'),
    LLAMA_SERVER_MODEL: path.join(root, 'models', 'gemma-4-offline.gguf'),
    LLAMA_SERVER_URL: url,
    SUBSTRATE_MODEL: 'gemma-4-offline',
  };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    // A fresh operator wallet, signed for real: the proof owns its own identity.
    const wallet = Wallet.createRandom();
    const { generateChallenge, verifySignature, createSessionToken } = await import('../../backend/services/auth.js');
    const challenge = generateChallenge(wallet.address);
    const verified = verifySignature(wallet.address, challenge, await wallet.signMessage(challenge));
    if (!verified) throw new Error('Real witness challenge verification failed.');
    const token = createSessionToken(verified);
    // Only an ownership fixture, no DNA or being creation.
    await fs.mkdir(path.join(env.WORKSPACES_ROOT, 'model-bar-proof'), { recursive: true });
    await fs.writeFile(path.join(env.WORKSPACES_ROOT, 'model-bar-proof', 'owner.json'), JSON.stringify({ wallet: verified }));
    const { setConfig } = await import('../../backend/services/llm-provider.js');
    setConfig({ provider: 'llama-server', endpoint: url, apiKey: '', model: 'gemma-4-offline' });
    const { default: router } = await import('../../backend/routes/inference-routes.js');
    const { requireAuth } = await import('../../backend/services/auth.js');
    const { substrateModelView } = await import('../../backend/services/substrate-model-view.js');
    app.use('/api/v1/inference', router);
    app.get('/api/v1/llm/substrate/models', requireAuth, async (_req, res, next) => {
      try { res.json(await substrateModelView()); } catch (error) { next(error); }
    });
    return { token, restore };
  } catch (error) {
    restore();
    throw error;
  }
};
