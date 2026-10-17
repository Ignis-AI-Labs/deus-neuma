// The semantic UI sound vocabulary must be honest: every intent binds to an
// event that exists in the ratified manifest AND has a real slice in the
// committed baked sprite — a mapping to a missing cue is a silent button
// wearing a sound's name.
import { describe, it, expect } from 'vitest';
import { UI_SOUND } from '../../frontend/services/ui-sound-map.js';
import { SOUND_MANIFEST } from '../../frontend/services/sound-manifest.js';
import spriteIndex from '../../frontend/sounds-baked/sprite.json';

describe('UI_SOUND vocabulary', () => {
  it('covers the six intents', () => {
    expect(Object.keys(UI_SOUND).sort()).toEqual(
      ['activate', 'close', 'deny', 'open', 'tick', 'toggle'],
    );
  });

  it('every intent maps to a ratified manifest event', () => {
    for (const event of Object.values(UI_SOUND)) {
      expect(SOUND_MANIFEST[event], `${event} missing from manifest`).toBeDefined();
    }
  });

  it('every mapped event has a real slice in the baked sprite', () => {
    for (const event of Object.values(UI_SOUND)) {
      expect(spriteIndex.events[event], `${event} missing from baked sprite`).toBeDefined();
    }
  });

  it('the typing bed (neumaReplying loop) is baked too', () => {
    expect(spriteIndex.events.neumaReplying).toBeDefined();
  });
});
