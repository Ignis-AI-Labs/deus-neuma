import { getTextSize, subscribeTextSize } from '../../../services/text-size.js';

/** impure — xterm renders its own metrics, so refit and resize the PTY too. */
export const bindTerminalTextSize = (term, syncSize) => {
  const update = () => {
    term.options.fontSize = 13 * getTextSize() / 100;
    syncSize();
  };
  update();
  return subscribeTextSize(update);
};
