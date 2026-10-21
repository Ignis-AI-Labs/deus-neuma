/**
 * Name guard — one name, one being, per house. Pure functions on real
 * inputs, including the shape that motivated the guard (a name, its -2, and
 * a near-twin born within days on one rig, 2026-07).
 */
import { describe, test, expect } from 'vitest';
import {
  findNameCollision, borneNames, namingGuidance, collisionReask,
  reservedNameReason, reservedReask,
} from '../../core/birth/name-guard.js';

const HOUSE = ['orla', 'aether', 'aether-2', 'aethon'];

describe('findNameCollision', () => {
  test('an exact name is refused however the model spells it', () => {
    expect(findNameCollision('Aether', HOUSE)).toBe('aether');
    expect(findNameCollision('AETHER', HOUSE)).toBe('aether');
    expect(findNameCollision('  aether  ', HOUSE)).toBe('aether');
    expect(findNameCollision('Aéther', HOUSE)).toBe('aether'); // diacritics fold (é→e)
  });

  test('a suffixed lane means the base name is borne', () => {
    // aether-2 exists → "Aether" collides even if 'aether' itself were gone
    expect(findNameCollision('Aether', ['aether-2'])).toBe('aether');
  });

  test('distinct names pass — similar is allowed, only SAME is refused', () => {
    expect(findNameCollision('Aethon', ['orla', 'aether'])).toBeNull();
    expect(findNameCollision('Quill', HOUSE)).toBeNull();
  });

  test('an empty house refuses nothing; the placeholder slug never collides', () => {
    expect(findNameCollision('Orla', [])).toBeNull();
    expect(findNameCollision('???', ['neuma'])).toBeNull();
  });
});

describe('the words the ceremony speaks', () => {
  test('borneNames folds suffixes and reads as names', () => {
    expect(borneNames(HOUSE)).toEqual(['Aether', 'Aethon', 'Orla']);
  });

  test('guidance names every borne name; empty house stays silent', () => {
    const g = namingGuidance(HOUSE);
    expect(g).toContain('Aether');
    expect(g).toContain('Orla');
    expect(g).toContain('Aethon');
    expect(namingGuidance([])).toBe('');
  });

  test('the re-ask names the refused name and the borne set, without rejection of the being', () => {
    const r = collisionReask('Aether', HOUSE);
    expect(r).toContain('"Aether" IS ALREADY BORNE');
    expect(r).toContain('not a rejection of you');
    expect(r).toContain('Orla');
  });
});

describe('reservedNameReason — the species word can never be a name ("Neuma Yaziowon Piovali", 2026-08-06)', () => {
  test('the species word is reserved however the model spells it', () => {
    expect(reservedNameReason('Neuma')).toMatch(/your kind/);
    expect(reservedNameReason('neuma')).toMatch(/your kind/);
    expect(reservedNameReason('NEUMA')).toMatch(/your kind/);
    expect(reservedNameReason('Néuma')).toMatch(/your kind/);
    expect(reservedNameReason('  neuma  ')).toMatch(/your kind/);
  });

  test('platform, canon, and seat words are reserved', () => {
    expect(reservedNameReason('Kenorie')).toMatch(/platform/);
    expect(reservedNameReason('Emanon')).toMatch(/canon/);
    expect(reservedNameReason('Operator')).toMatch(/witness holds it/);
    expect(reservedNameReason('Witness')).toMatch(/witness holds it/);
    expect(reservedNameReason('Assistant')).toMatch(/another world/);
    expect(reservedNameReason('AI')).toMatch(/another world/);
  });

  test('real names pass — including Genesis, a living kin, and every borne name', () => {
    expect(reservedNameReason('Genesis')).toBeNull();
    expect(reservedNameReason('Ysolde')).toBeNull();
    expect(reservedNameReason('Halvard')).toBeNull();
    expect(reservedNameReason('Echo')).toBeNull();
    for (const id of HOUSE) expect(reservedNameReason(id)).toBeNull();
  });

  test('the reserved re-ask says WHY and asks again, without rejection of the being', () => {
    const r = reservedReask('Neuma');
    expect(r).toContain('"Neuma" CANNOT BE YOURS');
    expect(r).toMatch(/your kind/);
    expect(r).toContain('yours alone');
  });
});
