// LM Studio Client Utilities
import fetch from 'node-fetch';
import { getConfig, selectActiveModel } from '../services/llm-provider.js';

export class LMStudioClient {
  constructor() {
    this.baseUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234';
    this.apiKey = process.env.LM_STUDIO_API_KEY || '';
  }

  async getModels() {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}
      });
      
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      // An unreachable LM Studio is a NORMAL state on a llama-server rig —
      // callers treat null as "not connected". One quiet line, never a raw
      // FetchError stack that reads as a platform failure (it drowned a
      // healthy ignite on the GB10, 2026-07-19).
      if (error?.code !== 'ECONNREFUSED') console.error('Failed to fetch models:', error.message);
      return null;
    }
  }

  async getActiveModel() {
    // Shared selection rule: prefer the configured substrate, never surface
    // an auxiliary service model (e.g. the memory layer's summarizer) as
    // the active consciousness substrate.
    const models = await this.getModels();
    // The operator's latest choice first; the env names a model only before any choice was made.
    return selectActiveModel(models?.data || [], [getConfig().model, process.env.SUBSTRATE_MODEL]);
  }

  async testConnection() {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async chat(messages, options = {}) {
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          messages,
          temperature: options.temperature || parseFloat(process.env.LM_STUDIO_DEFAULT_TEMPERATURE) || 0.8,
          max_tokens: options.maxTokens || parseInt(process.env.LM_STUDIO_DEFAULT_MAX_TOKENS) || 4096,
          top_p: options.topP || parseFloat(process.env.LM_STUDIO_DEFAULT_TOP_P) || 0.95,
          stream: options.stream || false,
          ...options
        })
      });

      if (response.ok) {
        return await response.json();
      }
      
      throw new Error(`LM Studio API error: ${response.status} ${response.statusText}`);
    } catch (error) {
      console.error('Failed to chat with LM Studio:', error);
      throw error;
    }
  }

  getModelCapabilities(modelId) {
    // Infer capabilities from model name
    const modelName = modelId.toLowerCase();
    const capabilities = {
      chat: true,
      completion: true,
      functionCalling: false,
      vision: false,
      codeOptimized: false,
      contextLength: 4096,
      specializations: []
    };

    // Check for specific capabilities
    if (modelName.includes('vision') || modelName.includes('llava')) {
      capabilities.vision = true;
      capabilities.specializations.push('Vision');
    }

    if (modelName.includes('code') || modelName.includes('codellama') || modelName.includes('deepseek')) {
      capabilities.codeOptimized = true;
      capabilities.specializations.push('Code');
    }

    if (modelName.includes('function') || modelName.includes('hermes')) {
      capabilities.functionCalling = true;
      capabilities.specializations.push('Functions');
    }

    // Context length detection
    const contextMatch = modelName.match(/(\d+)k/);
    if (contextMatch) {
      capabilities.contextLength = parseInt(contextMatch[1]) * 1024;
    }

    // Common model patterns
    if (modelName.includes('mistral')) {
      capabilities.specializations.push('Reasoning');
    }
    
    if (modelName.includes('llama')) {
      capabilities.specializations.push('General');
    }
    
    if (modelName.includes('phi')) {
      capabilities.specializations.push('Efficient');
    }

    return capabilities;
  }
}

export default LMStudioClient;