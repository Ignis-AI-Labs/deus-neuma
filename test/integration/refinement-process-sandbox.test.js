import { describe, expect, it } from 'vitest';
import {
  REFINEMENT_RESOURCE_LIMITS,
  refinementExecutionEnvelope,
} from '../../core/refinement/training-authority-contract.js';
import { refinementChildEnvironment } from '../../backend/services/refinement-execution-authority.js';
import {
  refinementSandboxPaths,
} from '../../backend/services/refinement-training-process-resource.js';

const SHA256 = 'a'.repeat(64);
const EXECUTION_ENVELOPE = refinementExecutionEnvelope({
  wrapperExecutableSha256: SHA256,
  controllerExecutableSha256: SHA256,
  resourceLimiterExecutableSha256: SHA256,
  sandboxExecutableSha256: SHA256,
  authorityConsumerPythonSha256: SHA256,
  authorityConsumerScriptSha256: SHA256,
  hostRuntimeIdentitySha256: SHA256,
  runtimeAuthoritySha256: SHA256,
  runtimeManifestSha256: SHA256,
  toolAuthoritySha256: SHA256,
  toolManifestSha256: SHA256,
  resources: REFINEMENT_RESOURCE_LIMITS,
  trainingSeed: 17,
});
const EXECUTION_PROJECTION = Object.freeze({
  guest: Object.freeze({
    python: '/runtime/bin/python',
    trainer: '/tool/scripts/refinement/train-adapter.py',
    converter: '/runtime/bin/convert-lora',
  }),
});

describe('refinement process sandbox contract', () => {
  it('projects only the immutable child environment committed by the envelope', () => {
    const environment = refinementChildEnvironment(EXECUTION_ENVELOPE);
    expect(environment).toMatchObject({
      HOME: '/nonexistent',
      PATH: '/runtime/bin',
      TMPDIR: '/work',
      PYTHONHASHSEED: '17',
      CUDA_VISIBLE_DEVICES: '',
      NVIDIA_VISIBLE_DEVICES: '',
    });
    expect(environment).not.toHaveProperty('DNA_ENCRYPTION_KEY');
    expect(Object.isFrozen(environment)).toBe(true);
  });

  it('accepts only the fixed packed-runtime guest executable projection', () => {
    expect(refinementSandboxPaths(EXECUTION_PROJECTION)).toEqual({
      python: '/runtime/bin/python',
      trainer: '/tool/scripts/refinement/train-adapter.py',
      converter: '/runtime/bin/convert-lora',
    });
    expect(() => refinementSandboxPaths({
      guest: {
        python: process.execPath,
        trainer: '/tmp/trainer.py',
        converter: '/tmp/converter.py',
      },
    })).toThrow();
    expect(() => refinementSandboxPaths(process.execPath, '/tmp/trainer.py')).toThrow();
  });
});
