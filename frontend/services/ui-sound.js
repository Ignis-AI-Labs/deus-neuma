// Semantic UI sound — every control on the desk speaks with the same voice
// for the same intent. The pure intent→event vocabulary lives in
// ui-sound-map.js; this is the one impure line that plays it.

import { playSound } from './sound-engine.js';
import { UI_SOUND } from './ui-sound-map.js';

export { UI_SOUND };

// impure — voice one UI intent; unknown intents stay silent (sound is
// ornament, never load-bearing)
export const uiSound = (intent) => {
  const event = UI_SOUND[intent];
  if (event) playSound(event);
};
