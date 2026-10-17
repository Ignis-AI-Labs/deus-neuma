/**
 * The Craft's tool — skill summoning, lane-agnostic (#22 S4).
 *
 * A neuma and a sealed AI witness reach the SAME skills root through the same
 * tool, so name resolution, the acquisition write, and the composed turn live
 * here rather than in either lane's stream. The one thing that genuinely
 * differs is how a tool event reaches the portal — the two lanes send a
 * differently shaped frame — so `summonSkill` RETURNS the event for its caller
 * to send instead of sending it itself. That keeps this module free of any
 * socket and lets both runtimes stay honest about who acted.
 */

import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { skillService } from './skill-service.js';
import { createLogger } from './logger.js';

const log = createLogger('Skills');

// Advertised whenever the skills root has anything to summon. Carries an
// inputSchema so native-function-calling substrates call it natively; text
// substrates use the tool dialects unchanged.
export const USE_SKILL_TOOL = Object.freeze({
  name: 'use_skill',
  server: 'skill',
  description: 'Summon one of your skills by name — args {name}. The skill\'s full instructions return to you; follow them for the task at hand.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      name: Object.freeze({ type: 'string', description: 'A skill name from your skills list' }),
    }),
    required: Object.freeze(['name']),
  }),
});

// The standing menu carries a bounded hook per skill (skills-section.js), so
// this is the door to the rest: the FULL description of every match, without
// paying the whole library on every turn. Read-only — it discloses text the
// being already owns, exactly as `system/tool_search` discloses schemas.
export const SKILL_SEARCH_LIMIT = 6;
export const SKILL_SEARCH_LIMIT_MAX = 16;

export const SKILL_SEARCH_TOOL = Object.freeze({
  name: 'skill_search',
  server: 'skill',
  description: 'Look up your skills by name or by what the work needs — args {query, limit}. Each match returns its FULL description, so you can choose before summoning.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      query: Object.freeze({
        type: 'string',
        description: 'A skill name, or a phrase naming the work — such as debug a failing test or write documentation',
      }),
      limit: Object.freeze({
        type: 'integer',
        minimum: 1,
        maximum: SKILL_SEARCH_LIMIT_MAX,
        description: `maximum matches to return (default ${SKILL_SEARCH_LIMIT})`,
      }),
    }),
    required: Object.freeze(['query']),
    additionalProperties: false,
  }),
});

/** Does this parsed call target the skill tool? (accepts a few dialects) */
export const isSkillTool = (match) =>
  match.server === 'skill' || match.toolName === 'use_skill';

/** Does this parsed call target the library lookup rather than a summons? */
export const isSkillSearchTool = (match) =>
  match.toolName === 'skill_search' || match.tool === 'skill/skill_search';

// Pure — an exact name first, then a name prefix, then the skills matching the
// greatest share of a work phrase, name hits outranking description hits.
const skillSearchScore = (skill, query) => {
  const name = String(skill.name || '').toLowerCase();
  if (name === query) return 1_000;
  if (name.startsWith(query)) return 900;
  const terms = query.split(/\s+/).filter(Boolean);
  const haystack = `${name} ${String(skill.description || '').toLowerCase()}`;
  const matched = terms.filter((term) => haystack.includes(term));
  if (matched.length === 0) return -1;
  return matched.length * 100 + matched.filter((term) => name.includes(term)).length * 10;
};

/**
 * Rank one library against a query. Pure.
 * @param {Array<{name: string, description: string}>} skills
 * @param {*} rawQuery - the untrusted `query` argument off the tool call
 * @param {*} [rawLimit] - the untrusted `limit` argument
 * @returns {Array<{name: string, description: string}>} best first
 */
export const searchSkills = (skills, rawQuery, rawLimit = SKILL_SEARCH_LIMIT) => {
  const query = String(rawQuery || '').trim().toLowerCase().slice(0, 160);
  if (!query) return [];
  const limit = Number.isInteger(rawLimit)
    ? Math.min(SKILL_SEARCH_LIMIT_MAX, Math.max(1, rawLimit))
    : SKILL_SEARCH_LIMIT;
  return (skills || [])
    .map((skill) => ({ skill, score: skillSearchScore(skill, query) }))
    .filter(({ score }) => score >= 0)
    .sort((left, right) => right.score - left.score
      || String(left.skill.name).localeCompare(String(right.skill.name)))
    .slice(0, limit)
    .map(({ skill }) => skill);
};

/** A summoned skill's instructions get real room — truncating a protocol
 *  mid-step cripples it — but never an unbounded flood of the context. */
export const SKILL_RESULT_MAX_CHARS = 20000;

/** Wrapper headroom inside the skill cap: the composed turn (opening +
 *  <skill_instructions> tags + closing) must itself stay under the cap the
 *  result carries, or the downstream result formatter truncates a SECOND
 *  time — slicing off the closing tags and stacking two truncation marks. */
const SKILL_WRAP_HEADROOM = 400;

/**
 * Parse an operator slash-invocation ([…]) into
 * { name, input } or null when the thought is not a slash command.
 * @param {string} thought - the operator's raw words
 * @returns {{name: string, input: string}|null}
 */
export const parseSlashInvocation = (thought) => {
  const m = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]+))?$/.exec(String(thought || '').trim());
  return m ? Object.freeze({ name: m[1], input: (m[2] || '').trim() }) : null;
};

/**
 * The turn content for a summoned skill: instructions + who asked.
 * @param {string} name - the skill's name
 * @param {string} body - the skill's full instructions
 * @param {string} input - the operator's input, empty for a self-summons
 * @param {'operator'|'self'} summonedBy - who reached for it
 * @returns {string}
 */
export const composeSkillTurn = (name, body, input, summonedBy) => {
  const bodyCap = SKILL_RESULT_MAX_CHARS - SKILL_WRAP_HEADROOM;
  const capped = body.length > bodyCap
    ? `${body.slice(0, bodyCap)}\n[skill instructions truncated — ${body.length} chars total]`
    : body;
  const opening = summonedBy === 'operator'
    ? `Your operator summoned your skill "${name}". Its instructions:`
    : `You summoned your skill "${name}". Its instructions:`;
  const closing = input
    ? `Your operator's input for this skill:\n${input}`
    : 'Follow the skill now.';
  return `${opening}\n\n<skill_instructions>\n${capped}\n</skill_instructions>\n\n${closing}`;
};

/**
 * Record the use in the lane's own tree (honest acquisition: used ⇒ acquired).
 * Non-critical: a summons must not fail because the tree write did. Works for
 * a witness lane exactly as for a neuma's — both are workspaces through the
 * same engine, so the craft a sealed peer picks up lands in ITS OWN lane.
 *
 * impure (workspace write)
 * @param {string|null} laneId - the summoning lane
 * @param {string} skillName - the skill that was summoned
 * @returns {Promise<void>}
 */
export const recordSkillUse = async (laneId, skillName) => {
  if (!laneId) return;
  try { await neumaWorkspace.recordSkillUse(laneId, skillName); }
  catch (err) { log.warn('skill use not recorded', { skillName, err: err.message }); }
};

/**
 * Resolve a summons into the tool result its lane feeds back and the event
 * that lane should emit. An unknown name is answered, never thrown: the model
 * gets its real library back so the next reach can be correct.
 *
 * impure (skills root read + acquisition write)
 * @param {string|null} laneId - the summoning lane
 * @param {*} rawName - the untrusted `name` argument off the tool call
 * @returns {Promise<{result: Object, event: Object}>}
 */
export const summonSkill = async (laneId, rawName) => {
  const tool = 'skill/use_skill';
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  const skill = name ? await skillService.getSkill(name) : undefined;

  if (!skill) {
    const known = (await skillService.listSkills()).map((s) => s.name);
    const content = `No skill named '${name || '(none given)'}'. Your skills: ${known.join(', ') || '(none installed)'}.`;
    return Object.freeze({
      result: { tool, status: 'ok', content },
      event: { tool, status: 'unavailable', summary: `skill ${name || '?'} — not found`, detail: content },
    });
  }

  await recordSkillUse(laneId, skill.name);
  return Object.freeze({
    result: {
      tool,
      status: 'ok',
      content: composeSkillTurn(skill.name, skill.body, '', 'self'),
      cap: SKILL_RESULT_MAX_CHARS,
    },
    event: {
      tool: `skill/${skill.name}`,
      status: 'ok',
      summary: `summoned ${skill.name}`,
      detail: skill.description,
    },
  });
};

/**
 * Resolve a library lookup into the tool result its lane feeds back and the
 * event that lane should emit. A query that matches nothing is answered with
 * the real library's names, never thrown — the same honesty `summonSkill`
 * gives an unknown name, so the next reach can be correct.
 *
 * No acquisition is recorded: reading a description is not learning a craft.
 *
 * impure (skills root read)
 * @param {Object} [args] - the untrusted tool arguments ({query, limit})
 * @returns {Promise<{result: Object, event: Object}>}
 */
export const searchSkillLibrary = async (args = {}) => {
  const tool = 'skill/skill_search';
  const query = String(args?.query || '').trim();
  if (!query) {
    const error = 'query must name a skill or the work you need one for';
    return Object.freeze({
      result: { tool, status: 'error', error },
      event: { tool, status: 'error', summary: 'skill_search — no query', detail: error },
    });
  }
  const library = await skillService.listSkills();
  const matches = searchSkills(library, query, args?.limit);
  const content = JSON.stringify({
    query,
    skills: matches.map((skill) => ({ name: skill.name, description: skill.description })),
    ...(matches.length === 0 ? { yourSkills: library.map((skill) => skill.name) } : {}),
  });
  return Object.freeze({
    result: { tool, status: 'ok', content },
    event: {
      tool,
      status: 'ok',
      summary: `skill_search "${query}" — ${matches.length} match${matches.length === 1 ? '' : 'es'}`,
      detail: matches.map((skill) => skill.name).join(', ') || 'no match',
    },
  });
};
