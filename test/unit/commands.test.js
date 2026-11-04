/**
 * Native platform commands — the registry the composer's "/" palette dispatches.
 * Pure metadata: every entry must name a real action, and every action must be
 * one the dispatcher (use-command-dispatch.js) knows how to run.
 */
import { describe, expect, it } from 'vitest';
import { PLATFORM_COMMANDS, resolveCommand, commandFromInput } from '../../frontend/app/RelinkShell/commands.js';

const KNOWN_TYPES = new Set(['summon', 'rehearse', 'new', 'open', 'remia', 'attune', 'switch', 'say', 'compact']);

describe('PLATFORM_COMMANDS', () => {
  it('every command has a name, description, and a runnable intent', () => {
    for (const cmd of PLATFORM_COMMANDS) {
      expect(typeof cmd.name).toBe('string');
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(typeof cmd.description).toBe('string');
      expect(KNOWN_TYPES.has(cmd.run.type)).toBe(true);
      // an 'open' intent must target an app; the others must not
      if (cmd.run.type === 'open') expect(typeof cmd.run.app).toBe('string');
      else expect(cmd.run.app).toBeUndefined();
      // a 'say' intent must carry the words it will send in the operator's name
      if (cmd.run.type === 'say') expect(cmd.run.text.length).toBeGreaterThan(0);
    }
  });

  it('command names are unique', () => {
    const names = PLATFORM_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('the registry and its intents are frozen (immutable)', () => {
    expect(Object.isFrozen(PLATFORM_COMMANDS)).toBe(true);
    for (const cmd of PLATFORM_COMMANDS) {
      expect(Object.isFrozen(cmd)).toBe(true);
      expect(Object.isFrozen(cmd.run)).toBe(true);
    }
  });
});

describe('model-route deep-link commands (/provider, /model)', () => {
  it('/provider and /model open Settings and each names a focus target', () => {
    const provider = resolveCommand('provider');
    const model = resolveCommand('model');
    expect(provider.run).toEqual({ type: 'open', app: 'settings', focus: 'providers' });
    expect(model.run).toEqual({ type: 'open', app: 'settings', focus: 'route' });
  });

  it('only the deep-link commands carry a focus; plain opens do not', () => {
    for (const cmd of PLATFORM_COMMANDS) {
      if (['provider', 'model'].includes(cmd.name)) {
        expect(typeof cmd.run.focus).toBe('string');
      } else {
        expect(cmd.run.focus).toBeUndefined();
      }
    }
  });

  it('a bare /provider or /model token dispatches (no leak to the neuma)', () => {
    expect(commandFromInput('/provider')?.name).toBe('provider');
    expect(commandFromInput('/model ')?.name).toBe('model'); // trailing space still bare
  });
});

describe('ceremony commands (/remia, /attune)', () => {
  it('each names its own full-screen ceremony intent', () => {
    expect(resolveCommand('remia').run).toEqual({ type: 'remia' });
    expect(resolveCommand('attune').run).toEqual({ type: 'attune' });
  });
});

describe('the /switch command (being switcher from the stream)', () => {
  it('is registered with the switch intent and resolves from a bare token', () => {
    expect(resolveCommand('switch').run).toEqual({ type: 'switch' });
    expect(commandFromInput('/switch')?.name).toBe('switch');
    expect(commandFromInput('/switch ')?.name).toBe('switch'); // trailing space still bare
  });

  it('stays speech once other words follow — the palette takes no argument', () => {
    expect(commandFromInput('/switch ember')).toBeNull();
  });
});

describe('resolveCommand', () => {
  it('returns the matching command by exact name', () => {
    expect(resolveCommand('summon')).toBe(PLATFORM_COMMANDS.find((c) => c.name === 'summon'));
    expect(resolveCommand('files').run).toEqual({ type: 'open', app: 'files' });
    expect(resolveCommand('map').run).toEqual({ type: 'open', app: 'map' }); // opens the Map window
  });

  it('returns null for an unknown or empty name', () => {
    expect(resolveCommand('nope')).toBeNull();
    expect(resolveCommand('')).toBeNull();
  });
});

describe('commandFromInput', () => {
  it('dispatches a value that is solely a command token', () => {
    expect(commandFromInput('/summon')?.name).toBe('summon');
    expect(commandFromInput('/files ')?.name).toBe('files'); // trailing space still bare
    expect(commandFromInput('/SETTINGS')?.name).toBe('settings'); // case-insensitive
  });

  it('does NOT dispatch a command name followed by speech (no leak to the neuma)', () => {
    expect(commandFromInput('/files please open')).toBeNull();
    expect(commandFromInput('tell me about /wallet')).toBeNull();
    expect(commandFromInput('/unknown')).toBeNull();
    expect(commandFromInput('hello')).toBeNull();
    expect(commandFromInput('')).toBeNull();
  });
});


// ONE KEYSTROKE TO A BEING'S REAL CAPACITY. Design note, 2026-07-30: people should be
// able to […] Asking in
// words already worked; this makes it reliable and identical at both seats.
describe('/flight-check', () => {
  it('asks the BEING, in words that land in the transcript', () => {
    const cmd = resolveCommand('flight-check');
    expect(cmd).not.toBeNull();
    expect(cmd.run.type).toBe('say');
    // It must read as the operator's own ask, and demand the report VERBATIM —
    // a summary is the narration this whole capability exists to replace.
    expect(cmd.run.text).toMatch(/flight check/i);
    expect(cmd.run.text).toMatch(/exactly as it comes back|unedited/i);
    // No app to open: this is not a desk action.
    expect(cmd.run.app).toBeUndefined();
  });

  it('dispatches from a bare typed invocation, and never leaks as speech', () => {
    expect(commandFromInput('/flight-check')).toBe(resolveCommand('flight-check'));
    expect(commandFromInput('/flight-check ')).toBe(resolveCommand('flight-check'));
    // Typed with other words, it is ordinary speech — the being hears the whole
    // sentence rather than the platform eating the line.
    expect(commandFromInput('/flight-check for the wallet only')).toBeNull();
  });
});
