// Model Context Protocol (MCP) Integration
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { createLogger } from './logger.js';
import { helperEnvironment } from './agent-terminal-environment.js';
const log = createLogger('MCP');

class MCPService {
  constructor() {
    this.clients = new Map();
    this.activeTools = new Map();
  }

  /**
   * Connect to an MCP server via stdio transport and discover its available tools.
   * @param {string} name - Logical server name (e.g. 'filesystem')
   * @param {string} command - Command to launch the MCP server process
   * @param {string[]} [args=[]] - Command-line arguments for the server process
   * @param {Object} [env={}] - Additional environment variables merged over the helper environment
   * @returns {Promise<Client>} Connected MCP client instance
   * @throws {Error} If connection to the server fails
   */
  async connectToServer(name, command, args = [], env = {}) {
    log.info('Connecting to server', { server: name, command });

    try {
      const transportConfig = {
        command,
        args,
        // The server's own configured names over the helper essentials —
        // never the backend's secrets (helperEnvironment).
        env: { ...helperEnvironment(process.env, process.platform), ...env },
      };
      
      const transport = new StdioClientTransport(transportConfig);
      
      const client = new Client({
        name: `neuma-${name}`,
        version: '1.0.0',
      }, {
        capabilities: {}
      });
      
      // Connect with 30-second timeout to prevent indefinite hang
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`MCP server '${name}' connection timed out after 30s`)), 30000))
      ]);
      log.info('Connected to', { server: name });
      
      // List available tools
      const tools = await client.listTools();
      log.info('Tools discovered', { server: name, count: (tools.tools || []).length });

      this.clients.set(name, client);
      this.activeTools.set(name, tools.tools || []);
      
      return client;
    } catch (error) {
      log.error('Failed to connect', { name, error: error.message });
      throw error;
    }
  }

  /**
   * List all tools from all connected MCP servers, grouped by server name.
   * @returns {Promise<Array<{server: string, tools: Array}>>} Array of server tool groups
   */
  async listAllTools() {
    const allTools = [];
    
    for (const [serverName, tools] of this.activeTools) {
      allTools.push({
        server: serverName,
        tools: tools
      });
    }
    
    return allTools;
  }

  /**
   * Call a specific tool on a connected MCP server.
   * @param {string} serverName - Name of the connected server
   * @param {string} toolName - Name of the tool to invoke
   * @param {Object} [args={}] - Arguments to pass to the tool
   * @returns {Promise<Object>} Tool execution result
   * @throws {Error} If the server is not connected or the tool call fails
   */
  async callTool(serverName, toolName, args = {}) {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server ${serverName} not connected`);
    }

    log.debug('Calling tool', { tool: toolName, server: serverName, args });
    
    try {
      const result = await client.callTool({
        name: toolName,
        arguments: args
      });
      
      log.debug('Tool result', { result });
      return result;
    } catch (error) {
      log.error('Tool call failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Disconnect from a specific MCP server and remove its tools from the cache.
   * @param {string} serverName - Name of the server to disconnect
   * @returns {Promise<void>}
   */
  async disconnect(serverName) {
    const client = this.clients.get(serverName);
    if (client) {
      await client.close();
      this.clients.delete(serverName);
      this.activeTools.delete(serverName);
      log.info('Disconnected from server', { server: serverName });
    }
  }

  /**
   * Register an in-process (native) tool server under a logical name. The
   * clientLike must wear the same face a connected MCP Client does —
   * `callTool({name, arguments})` and `close()` — so callTool, listAllTools,
   * getToolsContext, and disconnect treat a platform organ and a spawned
   * process identically. Re-registration replaces cleanly (roots updates
   * re-register). See native-filesystem.js for why organs exist.
   * @param {string} name - Logical server name (e.g. 'filesystem')
   * @param {{callTool: Function, close: Function}} clientLike - In-process executor
   * @param {Array} [tools=[]] - Tool catalog to advertise for this server
   */
  registerNativeServer(name, clientLike, tools = []) {
    this.clients.set(name, clientLike);
    this.activeTools.set(name, tools);
    log.info('Native server registered', { server: name, tools: tools.length });
  }

  /**
   * Disconnect from all connected MCP servers and clear all tool caches.
   * @returns {Promise<void>}
   */
  async disconnectAll() {
    for (const [, client] of this.clients) {
      await client.close();
    }
    this.clients.clear();
    this.activeTools.clear();
    log.info('[MCP] All servers disconnected');
  }

  /**
   * Format all available tools from connected servers into a context object
   * suitable for injection into LLM system prompts.
   * @returns {{ available_tools: Array<{server: string, name: string, description: string, inputSchema: Object}>, usage_instructions: string, examples: string[] }} Tools context for prompt assembly
   */
  getToolsContext() {
    const tools = [];
    
    for (const [serverName, serverTools] of this.activeTools) {
      for (const tool of serverTools) {
        tools.push({
          server: serverName,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        });
      }
    }
    
    return {
      available_tools: tools,
      usage_instructions: "You MUST use these tools by including the exact format: [TOOL: server/tool_name {args}]",
      examples: [
        '[TOOL: fs/list {"path": "./src"}]',
        '[TOOL: fs/read {"path": "./README.md"}]'
      ]
    };
  }
}

export const mcpService = new MCPService();