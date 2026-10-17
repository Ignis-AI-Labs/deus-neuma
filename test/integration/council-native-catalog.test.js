/** #383: prove the real registered council catalog without a scripted model. */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { houseTools } from '../../backend/services/council-tool-guard.js';
import { HOUSE_TOOL_NAMES } from '../../backend/services/council-policy.js';
import { toOpenAITools } from '../../backend/services/tool-schema.js';

const EXPECTED = Object.freeze([
  'create_directory', 'delete_file', 'edit_file', 'get_file_info', 'list_directory',
  'move_file', 'read_file', 'read_text_file', 'search_content', 'search_files', 'write_file',
]);

beforeAll(() => {
  mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
});
afterAll(() => mcpService.disconnect('filesystem'));

test('council policy and filtered catalog retain exactly the approved capabilities', () => {
  expect([...HOUSE_TOOL_NAMES].sort()).toEqual(EXPECTED);
  expect(houseTools().map(({ name }) => name).sort()).toEqual(EXPECTED);
});

test('every approved capability reaches the native wire with its real schema', () => {
  const tools = houseTools();
  const native = toOpenAITools(tools);
  expect(native.map(({ function: fn }) => fn.name).sort()).toEqual(
    EXPECTED.map((name) => `filesystem__${name}`).sort(),
  );
  for (const tool of tools) {
    const wire = native.find(({ function: fn }) => fn.name === `filesystem__${tool.name}`);
    expect(wire.function.description).toBe(tool.description);
    expect(wire.function.description).toBeTruthy();
    expect(wire.function.parameters).toEqual(tool.inputSchema);
  }
});
