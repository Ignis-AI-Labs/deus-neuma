// The act soundboard's vocabulary, called for real (RULE 0). Three claims
// worth holding, none of which need a browser:
//
//   1. Every tool the platform ADVERTISES routes to a cue. The source of that
//      list is the real policy table (backend/services/tool-policy.js), not a
//      copy — so a tool added there and forgotten here fails this test rather
//      than shipping silent.
//   2. Every cue the vocabulary can produce has a real slice in the COMMITTED
//      sprite. A cue bound to nothing is a silent act wearing a sound's name.
//   3. An act speaks once, when it begins — and speaks again only if it
//      failed. The two streams say "beginning" with different words.
import { describe, it, expect } from 'vitest';
import {
  ACT_CUES, ACT_FAMILIES, FAILED_CUE, actCue, cueForAct,
} from '../../frontend/services/act-sound-map.js';
import { SOUND_MANIFEST } from '../../frontend/services/sound-manifest.js';
import { GLOBAL_DEFAULTS } from '../../backend/services/tool-policy.js';
import spriteIndex from '../../frontend/sounds-baked/sprite.json';

const advertisedTools = () => Object.values(GLOBAL_DEFAULTS).flatMap(
  (policy) => [...(policy.allowed || []), ...(policy.requireApproval || [])],
);

describe('act soundboard vocabulary', () => {
  it('every tool the real policy table advertises has a voice', () => {
    const tools = advertisedTools();
    expect(tools.length).toBeGreaterThan(60);
    for (const tool of tools) {
      expect(ACT_CUES, `${tool} routed nowhere`).toContain(actCue(tool));
    }
  });

  it('every advertised tool is placed BY HAND, not left to inference', () => {
    // Inference is the safety net for tools that land later — it must not be
    // load-bearing for the surface that exists today, or the board silently
    // drifts from what beings can actually do.
    const placed = new Set(Object.values(ACT_FAMILIES).flat());
    const unplaced = advertisedTools().filter((t) => !placed.has(t));
    expect(unplaced, `unplaced tools: ${unplaced.join(', ')}`).toEqual([]);
  });

  it('no tool is claimed by two families', () => {
    const all = Object.values(ACT_FAMILIES).flat();
    expect(all.length).toBe(new Set(all).size);
  });

  it('every cue is bound in the manifest AND baked into the sprite', () => {
    for (const cue of ACT_CUES) {
      expect(SOUND_MANIFEST[cue], `${cue} unbound in the manifest`).toBeDefined();
      expect(spriteIndex.events[cue], `${cue} missing from the baked sprite`).toBeDefined();
      expect(spriteIndex.events[cue].duration).toBeGreaterThan(0);
    }
  });

  it('act cues stay SHORT — they fire constantly during real work', () => {
    // The whole board is unusable if a read's cue outlasts the read. Forge is
    // the deliberate exception: making an image is a slow, rare act.
    for (const cue of ACT_CUES) {
      const limit = cue === 'actForge' ? 0.5 : 0.35;
      expect(spriteIndex.events[cue].duration, `${cue} is too long for an act cue`)
        .toBeLessThanOrEqual(limit);
    }
  });

  it('the families a witness would guess are the ones they get', () => {
    expect(actCue('read_file')).toBe('actRead');
    expect(actCue('edit_file')).toBe('actEdit');
    expect(actCue('copy')).toBe('actMove');
    expect(actCue('move')).toBe('actMove');
    expect(actCue('search_files')).toBe('actSearch');
    expect(actCue('write_file')).toBe('actWrite');
    expect(actCue('delete_file')).toBe('actDelete');
    expect(actCue('execute')).toBe('actExecute');
    expect(actCue('web_search')).toBe('actSearch');
    expect(actCue('web_fetch')).toBe('actReach');
    expect(actCue('email.send')).toBe('actSend');
    expect(actCue('generate_image')).toBe('actForge');
  });

  it('a server-qualified name resolves the same as a bare one', () => {
    // Both spellings really arrive — the frames differ by origin.
    expect(actCue('filesystem/read_file')).toBe(actCue('read_file'));
    expect(actCue('FILESYSTEM/Edit_File')).toBe('actEdit');
  });

  it('a tool nobody has classified still speaks, by its shape', () => {
    expect(actCue('delete_workspace')).toBe('actDelete');
    expect(actCue('publish_report')).toBe('actSend');
    expect(actCue('list_adapters')).toBe('actList');
    expect(actCue('run_benchmark')).toBe('actExecute');
    // The destructive reading wins over the generic one in a name carrying
    // both — 'archive_and_update' must not sound like an ordinary edit.
    expect(actCue('archive_and_update')).toBe('actDelete');
  });

  it('a tool with no recognisable shape is still not silent', () => {
    expect(actCue('kotodama')).toBe('actSense');
    expect(actCue('')).toBe('actSense');
    expect(actCue(undefined)).toBe('actSense');
  });
});

describe('when an act speaks', () => {
  it('speaks its own voice as it begins — in EITHER stream dialect', () => {
    // The one-on-one portal's word…
    expect(cueForAct({ tool: 'read_file', status: 'executing' })).toBe('actRead');
    // …and the council room's.
    expect(cueForAct({ tool: 'edit_file', status: 'acting' })).toBe('actEdit');
  });

  it('says nothing more when it simply worked', () => {
    expect(cueForAct({ tool: 'read_file', status: 'ok' })).toBeNull();
    expect(cueForAct({ tool: 'edit_file', ok: true })).toBeNull();
  });

  it('is heard when it did NOT happen, in either dialect', () => {
    expect(cueForAct({ tool: 'write_file', status: 'error' })).toBe(FAILED_CUE);
    expect(cueForAct({ tool: 'delete_file', status: 'denied' })).toBe(FAILED_CUE);
    expect(cueForAct({ tool: 'execute', status: 'unsafe_args' })).toBe(FAILED_CUE);
    expect(cueForAct({ tool: 'edit_file', ok: false })).toBe(FAILED_CUE);
  });

  it('stays quiet while the operator decides — the approval card sounds for itself', () => {
    expect(cueForAct({ tool: 'delete_file', status: 'approval_required' })).toBeNull();
  });

  it('fails silent on a frame that is not one', () => {
    expect(cueForAct(null)).toBeNull();
    expect(cueForAct(undefined)).toBeNull();
    expect(cueForAct('read_file')).toBeNull();
    expect(cueForAct({})).toBeNull();
  });
});
