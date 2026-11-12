/**
 * TOOL CONFORMANCE — generated from every schema the platform advertises, for
 * every seat (tool fluency, Design note, 2026-11-12: […]). Nothing here is written per tool: a tool added tomorrow is
 * held to the same law the day it ships. RULE 0: the real catalog builders,
 * the real gate, the real argument check.
 *
 * The law, per tool:
 *  1. its schema is one the argument check can read (an object of typed fields;
 *     every required field declared; every list says what it holds);
 *  2. its name survives every spelling the platform accepts — `server/name`,
 *     the native `server__name`, both through the system/call door — on the
 *     FIRST call;
 *  3. a correct call is never refused; a dropped required field is named; a
 *     field in another spelling style is read as meant; a value of the wrong
 *     type is said.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { platformToolsFor } from '../../backend/services/portal-tool-catalog.js';
import { FS_PRIMITIVE_TOOLS } from '../../backend/services/fs-primitives.js';
import { WITNESS_CODING_TOOLS } from '../../backend/services/coding-tool-definitions.js';
import { WITNESS_CONTEXT_TOOLS } from '../../backend/services/witness-tools.js';
import { ACCESS_REQUEST_TOOL } from '../../backend/services/access-request-being-tools.js';
import { SUBSTRATE_FACTS_TOOL } from '../../backend/services/substrate-facts-being-tool.js';
import { TOOL_DOORS } from '../../backend/services/being-tool-surface.js';
import { admitCall } from '../../backend/services/turn-catalog-gate.js';
import { fitToolArgs } from '../../backend/services/tool-args-check.js';
import { unwrapCall } from '../../backend/services/tool-hud.js';
import { decodeToolName, encodeToolName } from '../../backend/services/tool-schema.js';

const WALLET = '0x0000000000000000000000000000000000000001';
const JSON_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);
const FUNCTION_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const SEATS = {
  neuma: { companion: { neumaId: 'neuma-orrin' }, walletAddress: WALLET, space: null },
  harness: { companion: { neumaId: 'harness-0a1b2c3d', participantKind: 'harness' }, walletAddress: WALLET, space: null },
  witness: { companion: { neumaId: 'witness-conformance', participantKind: 'witness' }, walletAddress: WALLET, space: null },
};
const LOCAL = { neuma: [...FS_PRIMITIVE_TOOLS, ...WITNESS_CODING_TOOLS, ACCESS_REQUEST_TOOL, SUBSTRATE_FACTS_TOOL, ...TOOL_DOORS],
  harness: [...FS_PRIMITIVE_TOOLS, ...WITNESS_CODING_TOOLS, ...TOOL_DOORS],
  witness: [...FS_PRIMITIVE_TOOLS, ...WITNESS_CODING_TOOLS, ...WITNESS_CONTEXT_TOOLS] };

const catalogs = {};
const idOf = (tool) => `${tool.server}/${tool.name}`;
const typesOf = (prop) => (Array.isArray(prop?.type) ? prop.type : prop?.type ? [prop.type] : []);

// pure — a value of the declared type, the first choice where there are choices
const sample = (prop) => {
  if (Array.isArray(prop?.enum)) return prop.enum[0];
  const type = typesOf(prop).find((t) => t !== 'null');
  if (type === 'string') return 'x';
  if (type === 'number' || type === 'integer') return 1;
  if (type === 'boolean') return true;
  if (type === 'array') return prop.items ? [sample(prop.items)] : [];
  if (type === 'object') return minimal(prop);
  return 'x';
};
// pure — a call carrying exactly the required fields
const minimal = (schema) => Object.fromEntries((schema?.required ?? []).map((name) => [name, sample(schema.properties[name])]));
// pure — the same name in the other spelling style (camelCase ↔ snake_case)
const restyled = (name) => (/[A-Z]/.test(name) ? name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`) : name.replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
// pure — a value no reading makes right: not a list, not one item of the list, not an object, not a number
const wrongValueFor = (prop) => {
  if (typesOf(prop).includes('array')) return typesOf(prop.items).includes('boolean') ? 'nope' : true;
  return typesOf(prop).includes('object') ? 'nope' : { not: 'this' };
};

beforeAll(async () => {
  for (const [seat, connection] of Object.entries(SEATS)) {
    const { tools } = await platformToolsFor(connection, { seat });
    const byId = new Map([...LOCAL[seat], ...tools].map((tool) => [idOf(tool), tool]));
    catalogs[seat] = [...byId.values()];
  }
});

describe.each(Object.keys(SEATS))('the %s seat', (seat) => {
  it('advertises tools at all', () => { expect(catalogs[seat].length).toBeGreaterThan(10); });

  it('every schema is one the argument check can read', () => {
    const faults = [];
    const walk = (schema, where) => {
      if (schema?.type !== 'object') faults.push(`${where}: type is ${schema?.type}, not object`);
      const props = schema?.properties ?? {};
      for (const name of schema?.required ?? []) if (!(name in props)) faults.push(`${where}: required ${name} is not declared`);
      for (const [name, prop] of Object.entries(props)) {
        const types = typesOf(prop);
        if (types.length === 0 && !Array.isArray(prop?.enum)) faults.push(`${where}.${name}: no type`);
        for (const t of types) if (!JSON_TYPES.has(t)) faults.push(`${where}.${name}: unknown type ${t}`);
        if (types.includes('array') && !prop.items) faults.push(`${where}.${name}: a list that does not say what it holds`);
        if (types.includes('array') && prop.items?.properties) walk(prop.items, `${where}.${name}[]`);
        if (types.includes('object') && prop.properties) walk(prop, `${where}.${name}`);
      }
    };
    for (const tool of catalogs[seat]) {
      if (!tool.inputSchema) faults.push(`${idOf(tool)}: no schema`);
      else walk(tool.inputSchema, idOf(tool));
    }
    expect(faults).toEqual([]);
  });

  it('every name is a legal function name, unique, and free of the joins', () => {
    const ids = catalogs[seat].map(idOf);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    const bad = catalogs[seat].filter((tool) => !FUNCTION_NAME.test(encodeToolName(tool.server, tool.name))
      || tool.name.includes('/') || tool.name.includes('__') || tool.server.includes('__'));
    expect(bad.map(idOf)).toEqual([]);
  });

  it('every tool is reached on the FIRST call in every spelling the platform accepts', () => {
    const connection = { ...SEATS[seat], _turnCatalog: catalogs[seat] };
    const missed = [];
    for (const tool of catalogs[seat]) {
      const args = minimal(tool.inputSchema);
      const native = decodeToolName(encodeToolName(tool.server, tool.name));
      const door = (named) => unwrapCall({ server: 'system', toolName: 'call', tool: 'system/call', args: { tool: named, args } });
      const spellings = {
        slash: { server: tool.server, toolName: tool.name, tool: idOf(tool), args },
        native: { ...native, tool: idOf(tool), args },
        // the door never names itself (audit C1: a second unwrap would run past the checks)
        ...(idOf(tool) === 'system/call' ? {} : {
          'door slash': door(idOf(tool)),
          'door native': door(encodeToolName(tool.server, tool.name)),
        }),
      };
      for (const [how, match] of Object.entries(spellings)) {
        const { refused, match: admitted } = admitCall(connection, match);
        if (refused || admitted.server !== tool.server || admitted.toolName !== tool.name) {
          missed.push(`${idOf(tool)} (${how}): ${refused?.error ?? `${admitted.server}/${admitted.toolName}`}`);
        }
      }
    }
    expect(missed).toEqual([]);
  });

  it('a correct call is never refused; a dropped required field is named', () => {
    const faults = [];
    for (const tool of catalogs[seat]) {
      const args = minimal(tool.inputSchema);
      const fit = fitToolArgs(tool.inputSchema, args);
      if (fit.problems.length > 0) faults.push(`${idOf(tool)} refused a correct call: ${fit.problems.join('; ')}`);
      for (const name of tool.inputSchema.required ?? []) {
        const { [name]: _dropped, ...rest } = args;
        if (!fitToolArgs(tool.inputSchema, rest).problems.includes(`${name} is required`)) faults.push(`${idOf(tool)}: dropping ${name} was not named`);
      }
    }
    expect(faults).toEqual([]);
  });

  it('every field in the other spelling style is read as meant; every wrong type is said', () => {
    const faults = [];
    for (const tool of catalogs[seat]) {
      const base = minimal(tool.inputSchema);
      for (const [name, prop] of Object.entries(tool.inputSchema.properties ?? {})) {
        const other = restyled(name);
        if (other !== name && !(other in tool.inputSchema.properties)) {
          const { [name]: _own, ...rest } = base;
          const fit = fitToolArgs(tool.inputSchema, { ...rest, [other]: sample(prop) });
          if (fit.problems.length > 0 || fit.args[name] === undefined) faults.push(`${idOf(tool)}: ${other} was not read as ${name}`);
        }
        if (typesOf(prop).length > 0 && !typesOf(prop).includes('string')) {
          const fit = fitToolArgs(tool.inputSchema, { ...base, [name]: wrongValueFor(prop) });
          if (!fit.problems.some((p) => p.startsWith(`${name} must be`))) faults.push(`${idOf(tool)}: a wrong ${name} was not said`);
        }
      }
    }
    expect(faults).toEqual([]);
  });
});
