// Prove the model Ollama resolved is the reviewed GGUF before loading or adopting it. impure (HTTP).
import { setupFailure } from './managed-ollama-errors.js';
import { ollamaBlobDigest } from './managed-ollama-models.js';

export const verifyModelRef = async (model, endpoint, signal) => {
  let res;
  try {
    res = await fetch(`${endpoint}/api/show`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: model.ref }),
    });
  } catch (error) {
    throw setupFailure('MODEL_PIN_MISMATCH', `the downloaded model's identity could not be checked: ${error.message}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw setupFailure('MODEL_PIN_MISMATCH', `the model server would not identify the downloaded model (HTTP ${res.status})`);
  const digest = ollamaBlobDigest(body);
  if (digest !== model.sha256) {
    throw setupFailure(
      'MODEL_PIN_MISMATCH',
      `the downloaded model blob ${digest ?? 'was missing or ambiguous'}; expected sha256-${model.sha256} from revision ${model.revision}`,
      'The downloaded model is not the reviewed build, so it was not used. Check the model repository, then press TRY AGAIN.',
    );
  }
  return Object.freeze({ digest });
};
