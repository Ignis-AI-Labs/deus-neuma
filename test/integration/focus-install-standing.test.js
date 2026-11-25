import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { getRoots, setRoots } from '../../backend/services/user-files.js';
import { updateToolWorkspace } from '../../backend/routes/portal-context.js';

describe('PR20 H-08: focus binding follows install standing', () => {
  let kit;
  let source;
  let priorRoots;

  beforeEach(async () => {
    kit = await createHarnessTurnKit('witness-focus-Standing');
    source = path.join(kit.root, 'source');
    await fs.mkdir(source);
    priorRoots = getRoots();
    setRoots([source]);
  });

  afterEach(async () => {
    setRoots(priorRoots);
    await kit?.close();
  });

  test('the owner binds the opened root and a guest cannot inherit it', async () => {
    await updateToolWorkspace(kit.connection, source);
    expect(kit.connection.toolWorkspace).toBe(source);

    kit.connection.walletAddress = '0x2222222222222222222222222222222222222222';
    await updateToolWorkspace(kit.connection, source);
    expect(kit.connection.toolWorkspace).toBeNull();
  });
});
