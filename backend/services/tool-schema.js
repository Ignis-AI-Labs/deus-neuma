/**
 * Tool Schema Adapter — pure functions that bridge the internal MCP tool
 * representation ({server, name, description, inputSchema}) and the OpenAI
 * native function-calling schema ([{type:'function', function:{name,description,parameters}}]).
 *
 * OpenAI function names must match ^[a-zA-Z0-9_-]{1,64}$ (no '/'), so a tool
 * like `filesystem/write_file` is encoded as `filesystem__write_file`. The
 * decode reverses on the first '__' so tool names containing '__' after the
 * server prefix still survive. Tools without an inputSchema are omitted from
 * the native schema (they keep working via the text protocol).
 */

const SEP = '__';

/** Encode a server/tool pair into a single OpenAI-valid function name. */
export const encodeToolName = (server, name) =>
  server ? `${server}${SEP}${name}` : String(name);

/**
 * Decode an OpenAI function name back into {server, toolName}. Returns a null
 * server when there is no '__' separator (the model used a bare tool name).
 */
export const decodeToolName = (functionName) => {
  const idx = String(functionName || '').indexOf(SEP);
  if (idx < 0) return Object.freeze({ server: null, toolName: String(functionName || '') });
  return Object.freeze({
    server: functionName.slice(0, idx),
    toolName: functionName.slice(idx + SEP.length),
  });
};

/**
 * Build the OpenAI tools schema from internal MCP tool objects. Tools without
 * an inputSchema are skipped (kept for the text-protocol fallback).
 * @param {Array<{server?: string, name: string, description?: string, inputSchema?: object}>} tools
 * @returns {Array<{type: 'function', function: {name: string, description: string, parameters: object}}>}
 */
export const toOpenAITools = (tools) => {
  if (!Array.isArray(tools)) return [];
  const out = [];
  for (const t of tools) {
    if (!t?.name || !t.inputSchema) continue;
    out.push(Object.freeze({
      type: 'function',
      function: Object.freeze({
        name: encodeToolName(t.server, t.name),
        description: t.description || t.name,
        parameters: t.inputSchema,
      }),
    }));
  }
  return out;
};

/**
 * Convert Chat Completions function tools to the Responses API's flat shape.
 * @param {Array<{type:'function',function:{name:string,description:string,parameters:object}}>} tools
 * @returns {Array<{type:'function',name:string,description:string,parameters:object,strict:boolean}>}
 */
export const toResponsesTools = (tools) => (tools || []).map((tool) => Object.freeze({
  type: 'function',
  name: tool.function.name,
  description: tool.function.description,
  parameters: tool.function.parameters,
  strict: false,
}));

/**
 * Convert Chat Completions function tools to the Anthropic Messages shape.
 * Anthropic takes {name, description, input_schema} — the encoded names ride
 * unchanged, so decodeToolName reverses identically on the way back (#259).
 * @param {Array<{type:'function',function:{name:string,description:string,parameters:object}}>} tools
 * @returns {Array<{name:string,description:string,input_schema:object}>}
 */
export const toAnthropicTools = (tools) => (tools || []).map((tool) => Object.freeze({
  name: tool.function.name,
  description: tool.function.description,
  input_schema: tool.function.parameters,
}));
