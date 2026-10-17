/**
 * TOOL SEARCH RELEVANCE — a being pays for what it asked for, and nothing else.
 *
 * WHY THIS EXISTS. Design note, 2026-08-30, watching a live turn: […]
 *
 * He was right, and the cause was not the model. A being searched
 * `fs list read write` — plainly the filesystem family — and the harness
 * activated eight schemas costing ~2071 tokens, ranked `social/queue_list`
 * FIRST, and cut `fs/search` entirely. Three defects compounded:
 *
 *   1. `includes` with no word boundary: `fs` matched inside "offset",
 *      `write` inside "rewrite", `read` inside "reading".
 *   2. The haystack was the description, so a LONG description had more
 *      chances to contain some short word by accident. Verbosity was
 *      rewarded — and then billed to the turn that activated it.
 *   3. Everything that matched at all was activated.
 *
 * These tests are written against the REAL exported tool definitions. Nothing
 * here is a fixture standing in for a catalog: if someone rewords
 * `social/queue_list` tomorrow, this test sees the new words, which is the
 * entire point — the old bug was a property of real descriptions nobody had
 * measured the matcher against.
 */
import { describe, expect, test } from 'vitest';
import { discloseTurnTools, TOOL_SEARCH_TOOL } from '../../backend/services/being-tool-surface.js';
import { FS_PRIMITIVE_TOOLS } from '../../backend/services/fs-primitives.js';
import { ACCESS_REQUEST_TOOL } from '../../backend/services/access-request-being-tools.js';
import { WEB_TOOLS } from '../../backend/services/web-being-tools.js';
import { MIND_TOOLS } from '../../backend/services/mind-tools.js';
import { MAP_TOOLS } from '../../backend/services/map-being-tools.js';
import { PLAN_SUBMIT_TOOL } from '../../backend/services/team-tool-defs.js';
import { SOCIAL_TOOLS } from '../../backend/services/portal-tools/social-read-tools.js';

/** The real catalog a being carries, assembled from the real definitions. */
const CATALOG = Object.freeze([
  TOOL_SEARCH_TOOL, PLAN_SUBMIT_TOOL, ACCESS_REQUEST_TOOL,
  ...FS_PRIMITIVE_TOOLS, ...WEB_TOOLS, ...MIND_TOOLS, ...MAP_TOOLS,
  ...SOCIAL_TOOLS,
]);

/** One search through the real code path. The connection shape is the real one. */
const search = (query, limit) => {
  const connection = { _turnCatalog: CATALOG, _turnDisclosedToolIds: new Set() };
  const result = discloseTurnTools(connection, { query, ...(limit ? { limit } : {}) });
  return {
    ids: JSON.parse(result.content).tools.map(({ id }) => id),
    disclosed: [...connection._turnDisclosedToolIds],
  };
};

const idsFor = (query, limit) => search(query, limit).ids;

describe('the catalog is the real one, so these measurements mean something', () => {
  test('it holds the tools whose real wording caused the bug', () => {
    const ids = CATALOG.map((t) => `${t.server}/${t.name}`);
    // Guards the test itself: if these ever stop riding the catalog the
    // assertions below would pass vacuously, proving nothing.
    expect(ids).toContain('social/queue_list');
    expect(ids).toContain('team/plan_submit');
    expect(ids).toContain('fs/search');
  });

  test('the offending words are STILL in the real descriptions', () => {
    // The fix must be the matcher, not a quiet reword of the tools it tripped
    // on. If someone "fixes" this by deleting the word "offset", this test
    // fails and says so — because the matcher would still be broken.
    const queueList = CATALOG.find((t) => `${t.server}/${t.name}` === 'social/queue_list');
    expect(queueList.description.toLowerCase()).toContain('offset');
    expect(PLAN_SUBMIT_TOOL.description.toLowerCase()).toMatch(/writes|reading/);
  });
});

describe('a term matches a WORD, never a fragment inside one', () => {
  /**
   * WHERE THE BOUNDARY ACTUALLY BITES, AND WHERE IT DOES NOT.
   *
   * Written, then disproved, then rewritten. The first version of this block
   * asserted the live case directly — […] — and it passed against the OLD substring matcher too.
   * Two other laws were shielding it: the family rule never let a social tool
   * into the pool, and the name filter dropped description-only matches
   * regardless of how they matched.
   *
   * So the boundary earns its keep on the WEAK path only: a query no tool
   * answers by name, where description matches are all there is. That is
   * exactly the vague query a being types when it is hunting — the case Founder
   * was watching. These use it, and go red without the boundary.
   */
  test('"ask" does not reach team/plan_submit through the word "task"', () => {
    expect(idsFor('ask')).not.toContain('team/plan_submit');
  });

  test('"back" does not reach web/web_fetch through the word "loopback"', () => {
    expect(idsFor('back')).not.toContain('web/web_fetch');
  });

  test('the fragments are STILL there — the fix is the matcher, not a reword', () => {
    // If someone "fixes" this by editing the word "task" out of plan_submit,
    // the two tests above would pass with the matcher still broken. This says
    // so out loud.
    const fetch = CATALOG.find((t) => `${t.server}/${t.name}` === 'web/web_fetch');
    expect(PLAN_SUBMIT_TOOL.description.toLowerCase()).toContain('task');
    expect(fetch.description.toLowerCase()).toContain('loopback');
  });

  test('but the boundary is LEADING only — "loop" still finds "loopback"', () => {
    // Demanding a whole word would break every capability phrase a being
    // naturally types: "write" must still find "writes", "read" "reading".
    expect(idsFor('loop')).toContain('web/web_fetch');
  });

  test('a query full of regex metacharacters is a query, not an injection', () => {
    for (const junk of ['fs/*', 'read(', 'a[b', 'c\\d', '.*', '$^']) {
      expect(() => idsFor(junk)).not.toThrow();
    }
  });
});

describe('a term naming a SERVER asks for that family', () => {
  test('the live query returns the WHOLE fs family and nothing else', () => {
    const ids = idsFor('fs list read write');
    expect(new Set(ids)).toEqual(new Set(FS_PRIMITIVE_TOOLS.map((t) => `fs/${t.name}`)));
  });

  test('fs/search comes back — the old ranking cut the one tool most wanted', () => {
    expect(idsFor('fs list read write')).toContain('fs/search');
  });

  test('no tool from another server rides along', () => {
    for (const id of idsFor('fs list read write')) expect(id.startsWith('fs/')).toBe(true);
  });

  test('the family costs LESS than the scattered eight it replaced', () => {
    // The old behaviour activated 8 schemas at ~8285 characters. The whole fs
    // family is smaller than that AND complete — the saving is not a trade
    // against coverage.
    const chars = idsFor('fs list read write')
      .map((id) => CATALOG.find((t) => `${t.server}/${t.name}` === id))
      .reduce((n, t) => n + t.description.length + JSON.stringify(t.inputSchema || {}).length, 0);
    expect(chars).toBeLessThan(8285);
  });
});

describe('an identifier outranks a description, always', () => {
  test('the longest description in the catalog does not win a query it merely mentions', () => {
    const longest = [...CATALOG].sort((a, b) => b.description.length - a.description.length)[0];
    // It is allowed to appear when it genuinely matches by name; it is not
    // allowed to appear merely for being long enough to contain the words.
    const ids = idsFor('read write list');
    const byName = `${longest.server}/${longest.name}`;
    if (ids.includes(byName)) {
      const words = byName.toLowerCase().split(/[^a-z0-9]+/);
      expect(words.some((w) => ['read', 'write', 'list'].some((term) => w.startsWith(term)))).toBe(true);
    }
  });

  test('a description-only match is dropped when anything matched by name', () => {
    // plan_submit says "writes" and "reading" in prose. It must not activate
    // for a query that named real tools.
    expect(idsFor('read write list')).not.toContain('team/plan_submit');
  });

  test('but a weak match still answers when nothing matched by name', () => {
    // A vague query answered poorly beats one answered not at all — silence
    // sends the being hunting through the whole index by hand.
    expect(idsFor('campaign').length).toBeGreaterThan(0);
  });
});

describe('an exact identifier hands back exactly one tool', () => {
  test('naming a tool is not a request to browse', () => {
    expect(idsFor('fs/read')).toEqual(['fs/read']);
    expect(idsFor('social/queue_list')).toEqual(['social/queue_list']);
  });

  test('it answers with that one tool\'s full arguments — and activates nothing (the wire never changes, 2026-10-14)', () => {
    const connection = { _turnCatalog: CATALOG, _turnDisclosedToolIds: new Set() };
    const [tool] = JSON.parse(discloseTurnTools(connection, { query: 'fs/read' }).content).tools;
    expect(tool.id).toBe('fs/read');
    expect(tool.args).toBeTruthy();
    expect([...connection._turnDisclosedToolIds]).toEqual([]);
  });
});

describe('the search activates nothing — it answers with contracts', () => {
  test('a broad search names each match with its signature and leaves the turn untouched', () => {
    const connection = { _turnCatalog: CATALOG, _turnDisclosedToolIds: new Set() };
    const result = discloseTurnTools(connection, { query: 'fs list read write' });
    const tools = JSON.parse(result.content).tools;
    expect(tools.length).toBeGreaterThan(1);
    expect(tools.every((t) => typeof t.signature === 'string' && t.call.startsWith('system/call'))).toBe(true);
    expect(result.activated).toEqual([]);
    expect([...connection._turnDisclosedToolIds]).toEqual([]);
  });

  test('the caller can ask for fewer', () => {
    expect(idsFor('fs list read write', 2)).toHaveLength(2);
  });

  test('an empty query activates nothing rather than everything', () => {
    for (const empty of ['', '   ', null, undefined]) {
      const connection = { _turnCatalog: CATALOG, _turnDisclosedToolIds: new Set() };
      expect(discloseTurnTools(connection, { query: empty }).count).toBe(0);
      expect([...connection._turnDisclosedToolIds]).toEqual([]);
    }
  });

  test('the search hand never discloses itself', () => {
    expect(idsFor('system tool_search')).not.toContain('system/tool_search');
  });
});

describe('the 2026-08-31 trim — helpers never answer an action phrase, and the crowd is capped', () => {
  test('"read file" ranks fs/read FIRST and never activates the access-request helper', () => {
    // The live failure Founder watched: seven schemas for a one-tool job, with
    // filesystem/request_file_access — an approval REQUEST, not a reader —
    // among them.
    const ids = idsFor('read file');
    expect(ids[0]).toBe('fs/read');
    expect(ids).not.toContain('filesystem/request_file_access');
  });

  test('the helper still answers when the query IS about access', () => {
    expect(idsFor('request access')).toContain('filesystem/request_file_access');
  });

  test('the default cap is four — the long tail cannot crowd a turn without asking', () => {
    // "file" is a description-only term across the real catalog: the weak
    // path, where the old default activated up to eight.
    const ids = idsFor('file');
    expect(ids.length).toBeLessThanOrEqual(4);
    expect(ids).not.toContain('filesystem/request_file_access');
  });

  test('the result payload keeps descriptions WHOLE — the HELD tier stamp is a suffix', () => {
    // A cap here once cut the [HELD — …] suffix off web tools (the stamp is
    // appended, web-being-tools.js). Descriptions ride verbatim.
    const connection = { _turnCatalog: CATALOG, _turnDisclosedToolIds: new Set() };
    const result = JSON.parse(discloseTurnTools(connection, { query: 'request access' }).content);
    const helper = result.tools.find(({ id }) => id === 'filesystem/request_file_access');
    expect(helper.description).toBe(ACCESS_REQUEST_TOOL.description);
    expect(helper.call).toBe('system/call {"tool": "filesystem/request_file_access", "args": {…}}');
  });

  test('a family ask still returns the WHOLE family — the default cap never cuts the hands', () => {
    expect(new Set(idsFor('fs list read write')))
      .toEqual(new Set(FS_PRIMITIVE_TOOLS.map((t) => `fs/${t.name}`)));
  });
});
