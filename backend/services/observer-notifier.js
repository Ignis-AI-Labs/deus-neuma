import { createLogger } from './logger.js';

const log = createLogger('ObserverNotifier');
const NO_PAYLOAD = Symbol('no-observer-payload');

const closedLabel = (label) => {
  switch (label) {
    case 'onRequest':
    case 'onUsage':
    case 'onFinishReason':
    case 'onMetrics':
    case 'onTelemetry':
    case 'onWireBody':
      return label;
    default:
      return 'observer';
  }
};

const closedErrorClass = (error) => {
  if (error instanceof TypeError) return 'TypeError';
  if (error instanceof RangeError) return 'RangeError';
  if (error instanceof ReferenceError) return 'ReferenceError';
  if (error instanceof SyntaxError) return 'SyntaxError';
  return error instanceof Error ? 'Error' : 'NonError';
};

const reportFailure = (label, error, rejected) => {
  try {
    log.warn('observer callback failed', {
      observer: closedLabel(label),
      errorClass: closedErrorClass(error),
      errorMessage: rejected ? 'observer rejected' : 'observer threw',
    });
  } catch {
    // Diagnostics can never become authority over the work they observe.
  }
};

/**
 * Invoke one diagnostic observer at its call-site seam without giving it
 * authority over provider or scheduler work. Thenables are handled but never
 * awaited, so observer latency cannot alter execution timing.
 */
export const notifyObserver = (label, observer, payload = NO_PAYLOAD) => {
  if (typeof observer !== 'function') return;
  try {
    const result = payload === NO_PAYLOAD ? observer() : observer(payload);
    if (result != null && typeof result.then === 'function') {
      Promise.resolve(result).catch((error) => reportFailure(label, error, true));
    }
  } catch (error) {
    reportFailure(label, error, false);
  }
};
