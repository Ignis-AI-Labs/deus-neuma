// impure — device-local accessibility preference, DOM and browser events.
const KEY = 'neuma-text-size';
const EVENT = 'neuma:text-size';

/** Validate the percentage at the storage and control boundaries. */
const validSize = (value) => Number.isInteger(value) && value >= 100 && value <= 200;

/** Current applied percentage; safe before boot and for new subscribers. */
export const getTextSize = () => {
  const value = Math.round(Number(document.documentElement.style.getPropertyValue('--text-scale')) * 100);
  return validSize(value) ? value : 100;
};

const apply = (value) => {
  document.documentElement.style.setProperty('--text-scale', String(value / 100));
  window.dispatchEvent(new Event(EVENT));
};

/** Subscribe to live changes, including another window's saved preference. */
export const subscribeTextSize = (listener) => {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
};

/** Save before applying so a storage refusal can be reported by the control. */
export const setTextSize = (value) => {
  if (!validSize(value)) throw new Error('Text size must be between 100% and 200%.');
  localStorage.setItem(KEY, String(value));
  apply(value);
};

/** Restore before mounting the app; malformed preferences fall back to 100%. */
export const bootTextSize = () => {
  try {
    const value = Number(localStorage.getItem(KEY));
    apply(validSize(value) ? value : 100);
  } catch (error) {
    apply(100);
    console.warn('Could not restore text size:', error.message);
  }
  const sync = (event) => {
    if (event.storageArea !== localStorage || (event.key !== KEY && event.key !== null)) return;
    const value = Number(event.newValue);
    apply(validSize(value) ? value : 100);
  };
  window.addEventListener('storage', sync);
  return () => window.removeEventListener('storage', sync);
};
