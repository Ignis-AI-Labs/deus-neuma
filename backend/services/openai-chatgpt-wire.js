/** OpenAI ChatGPT Codex wire metadata shared by models and inference. */

import { currentOpenAIClientVersion } from './openai-client-version.js';

/** Current public Codex protocol version, overridable for forward compatibility. */
export const openAIChatGPTClientVersion = currentOpenAIClientVersion;

/**
 * Build the account-bound headers required by ChatGPT's Codex backend.
 * @param {string} accessToken OAuth access token.
 * @param {string} accountId ChatGPT account/workspace id.
 * @returns {object} HTTP headers.
 */
export const openAIChatGPTHeaders = (accessToken, accountId) => {
  const version = openAIChatGPTClientVersion();
  return {
    Authorization: `Bearer ${accessToken}`,
    'ChatGPT-Account-ID': accountId,
    originator: 'neuma',
    version,
    'User-Agent': `neuma/0.1 (codex-wire/${version})`,
  };
};
