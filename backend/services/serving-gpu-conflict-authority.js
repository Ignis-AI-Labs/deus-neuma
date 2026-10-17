import { refinementGpuBinding } from './refinement-gpu-device-authority.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import { attestActiveServingGpu } from './llama-server-supervisor.js';

const exactRequest = (request) => {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('serving GPU conflict request is invalid');
  }
  const keys = Reflect.ownKeys(request);
  if (keys.length !== 2 || keys.some((key) => !['gpuBinding', 'operation'].includes(key))) {
    throw new Error('serving GPU conflict request is invalid');
  }
  return request;
};

/** Refuse a forge reservation when this process already serves on the same physical GPU. */
export const assertNoActiveServingGpuConflict = async (request) => {
  const { gpuBinding, operation } = exactRequest(request);
  const activeOperation = assertRefinementProcessOperation(operation);
  const requested = refinementGpuBinding(gpuBinding);
  const serving = await attestActiveServingGpu(activeOperation);
  activeOperation.assertActive();
  if (serving?.gpuUuid === requested.gpuUuid) {
    throw Object.assign(new Error('requested training GPU is held by active serving'), {
      code: 'TRAINING_GPU_BUSY',
    });
  }
  return Object.freeze({
    kind: 'serving-gpu-conflict-clearance-v1',
    gpuBindingSha256: requested.gpuBindingSha256,
  });
};
