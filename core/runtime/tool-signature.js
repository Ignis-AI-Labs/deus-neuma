/**
 * A tool's arguments in one line — `{path, offset?, limit?}`, an optional
 * argument marked `?` — and a tool as the HUD names it: `fs/read {path, …}`.
 * What a model needs to call a tool it already knows (backend/services/tool-hud.js). Pure.
 */
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {object|null} inputSchema @returns {string} */
export const signatureOf = (inputSchema) => {
  const props = plain(inputSchema?.properties) ? Object.keys(inputSchema.properties) : [];
  if (props.length === 0) return '{}';
  const required = new Set(Array.isArray(inputSchema.required) ? inputSchema.required : []);
  return `{${props.map((p) => (required.has(p) ? p : `${p}?`)).join(', ')}}`;
};

/** @param {{server: string, name: string, inputSchema?: object}} tool @returns {string} */
export const toolLine = (tool) => `${tool.server}/${tool.name} ${signatureOf(tool.inputSchema)}`;
