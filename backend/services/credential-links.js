// CREDENTIAL LINKS — where a person gets each key, token or address the
// platform can use, so a missing key is one click from fixed instead of a
// search. Every credential the desk (or an env setting) asks for has an entry:
// model providers, keyed services, posting channels, email, chain RPC, web
// search and page reading, model downloads, git, cloud voices, and the legal
// office's research APIs.
//
// Direct key pages where the provider has one (checked 2026-10-20); for the
// rest of the model catalog, the documentation link models.dev publishes
// (provider-docs-data.js, regenerated with sync-provider-catalog.mjs
// --links-only). Public URLs only: nothing here is secret. Pure.

import { PROVIDER_DOCS } from './provider-docs-data.js';

const link = (url, label, note = null) => Object.freeze({ url, label, ...(note ? { note } : {}) });

// The core model providers and the most-used catalog ones: their own key page.
const PROVIDER_KEY_PAGES = Object.freeze({
  openai: link('https://platform.openai.com/api-keys', 'OpenAI API keys'),
  anthropic: link('https://console.anthropic.com/settings/keys', 'Anthropic Console keys'),
  xai: link('https://console.x.ai/', 'xAI Console'),
  'z-ai': link('https://z.ai/manage-apikey/apikey-list', 'Z.ai API keys'),
  openrouter: link('https://openrouter.ai/settings/keys', 'OpenRouter keys'),
  deepseek: link('https://platform.deepseek.com/api_keys', 'DeepSeek API keys'),
  groq: link('https://console.groq.com/keys', 'Groq keys'),
  google: link('https://aistudio.google.com/apikey', 'Google AI Studio keys'),
  mistral: link('https://console.mistral.ai/api-keys', 'Mistral keys'),
  togetherai: link('https://api.together.ai/settings/api-keys', 'Together AI keys'),
  cerebras: link('https://cloud.cerebras.ai/', 'Cerebras Cloud'),
  'fireworks-ai': link('https://app.fireworks.ai/settings/users/api-keys', 'Fireworks keys'),
  deepinfra: link('https://deepinfra.com/dash/api_keys', 'DeepInfra keys'),
  huggingface: link('https://huggingface.co/settings/tokens', 'Hugging Face tokens'),
  cohere: link('https://dashboard.cohere.com/api-keys', 'Cohere keys'),
  perplexity: link('https://www.perplexity.ai/settings/api', 'Perplexity API'),
  'openai-chatgpt': link('https://chatgpt.com/', 'ChatGPT', 'no key: sign in with your ChatGPT plan below'),
  'github-models': link('https://github.com/settings/personal-access-tokens', 'GitHub fine-grained token', 'grant it the models:read permission'),
  'kimi-for-coding': link('https://www.kimi.com/coding/docs/en/', 'Kimi For Coding'),
  v0: link('https://v0.app/chat/settings/keys', 'v0 API keys'),
});

const RPC_CHOICES = Object.freeze([
  link('https://dashboard.alchemy.com/', 'Alchemy', 'free tier; make an app, copy its HTTPS URL for the network'),
  link('https://developer.metamask.io/', 'Infura (MetaMask Developer)', 'free tier; the network\'s HTTPS endpoint'),
  link('https://dashboard.quicknode.com/', 'QuickNode', 'free tier'),
  link('https://chainlist.org/', 'ChainList', 'public endpoints, no key — slower and rate-limited'),
]);

/** Everything that is not a model provider, by family and id. */
export const CREDENTIAL_LINKS = Object.freeze({
  // Every keyed service in Settings → API (provider-registry SERVICE_CATALOG).
  service: Object.freeze({
    tavily: link('https://app.tavily.com/home', 'Tavily API key'),
    exa: link('https://dashboard.exa.ai/api-keys', 'Exa API keys', 'the preferred index for web search'),
    brave: link('https://api-dashboard.search.brave.com/app/keys', 'Brave Search API keys', 'also the image-search backend'),
    searxng: link('https://docs.searxng.org/admin/installation.html', 'SearXNG (self-hosted)', 'no key: the address of your own instance'),
    'cloudflare-token': link('https://dash.cloudflare.com/profile/api-tokens', 'Cloudflare API tokens', 'create a token with "Browser Rendering - Edit"'),
    'cloudflare-account': link('https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/', 'Find your Cloudflare account id'),
    'hf-downloads': link('https://huggingface.co/settings/tokens', 'Hugging Face tokens', 'a Read token; also accept each gated model\'s licence on its page'),
    courtlistener: link('https://www.courtlistener.com/', 'CourtListener', 'free; sign in or create an account, then your profile has the API token'),
    'api-data-gov': link('https://api.data.gov/signup/', 'api.data.gov key', 'free; one key for Congress.gov, GovInfo and Regulations.gov'),
    openstates: link('https://open.pluralpolicy.com/accounts/profile/', 'Open States (Plural) API key', 'free; state bills in all 50 states'),
    'rpc-ethereum': RPC_CHOICES,
    'rpc-ethereum-sepolia': RPC_CHOICES,
    'rpc-base': RPC_CHOICES,
    'rpc-base-sepolia': RPC_CHOICES,
  }),
  channel: Object.freeze({
    x: link('https://developer.x.com/en/portal/dashboard', 'X Developer Portal', 'make an app with read and write permission, then generate its keys and access token'),
    telegram: link('https://core.telegram.org/bots/features#botfather', 'Telegram BotFather', 'message @BotFather, /newbot, copy the token'),
    discord: link('https://discord.com/developers/applications', 'Discord Developer Portal', 'new application → Bot → reset token; invite the bot to your server'),
    facebook: link('https://developers.facebook.com/apps/', 'Meta for Developers', 'a Page access token with pages_manage_posts'),
    mastodon: link('https://docs.joinmastodon.org/client/token/', 'Mastodon access tokens', 'on your instance: Preferences → Development → New application'),
    bluesky: link('https://bsky.app/settings/app-passwords', 'Bluesky app passwords', 'an app password, never your account password'),
    linkedin: link('https://www.linkedin.com/developers/apps', 'LinkedIn Developers', 'the token lasts 60 days'),
  }),
  email: Object.freeze({
    gmail: link('https://myaccount.google.com/apppasswords', 'Google app passwords', 'needs 2-Step Verification on; use the 16-letter app password, not your Google password'),
    other: link('https://support.google.com/accounts/answer/185833', 'What an app password is', 'other providers (Outlook, iCloud, Fastmail) issue their own in account security'),
  }),
  chain: Object.freeze({
    rpc: RPC_CHOICES,
  }),
  web: Object.freeze({
    exa: link('https://dashboard.exa.ai/api-keys', 'Exa API keys', 'the preferred index for web search'),
    brave: link('https://api-dashboard.search.brave.com/app/keys', 'Brave Search API keys', 'also the image-search backend'),
    searxng: link('https://docs.searxng.org/admin/installation.html', 'SearXNG (self-hosted)', 'no key: a URL to your own instance'),
    cloudflare: link('https://dash.cloudflare.com/profile/api-tokens', 'Cloudflare API tokens', 'reads pages that build themselves with JavaScript; the token needs "Browser Rendering - Edit", plus your account id'),
  }),
  downloads: Object.freeze({
    huggingface: link('https://huggingface.co/settings/tokens', 'Hugging Face tokens', 'a Read token; also accept each gated model\'s licence on its page'),
  }),
  git: Object.freeze({
    github: link('https://cli.github.com/manual/gh_auth_login', 'GitHub CLI sign-in', 'run gh auth login once on this machine'),
  }),
  voice: Object.freeze({
    cartesia: link('https://play.cartesia.ai/keys', 'Cartesia API keys'),
    elevenlabs: link('https://elevenlabs.io/app/settings/api-keys', 'ElevenLabs API keys'),
    hume: link('https://platform.hume.ai/settings/keys', 'Hume API keys'),
  }),
  research: Object.freeze({
    courtlistener: link('https://www.courtlistener.com/', 'CourtListener', 'free; sign in or create an account, then your profile has the API token'),
    'api-data-gov': link('https://api.data.gov/signup/', 'api.data.gov key', 'free; one key for Congress.gov, GovInfo and Regulations.gov'),
    openstates: link('https://open.pluralpolicy.com/accounts/profile/', 'Open States (Plural) API key', 'free; state bills in all 50 states'),
  }),
});

/**
 * Where to get a model provider's key: its own key page, else its docs. Pure.
 * @param {string} providerId
 * @returns {{url: string, label: string, note?: string}|null}
 */
export const providerKeyLink = (providerId) => {
  if (Object.prototype.hasOwnProperty.call(PROVIDER_KEY_PAGES, providerId)) return PROVIDER_KEY_PAGES[providerId];
  const doc = PROVIDER_DOCS[providerId];
  return doc ? link(doc, 'Provider docs (how to get a key)') : null;
};

/** The whole map, as the desk reads it once. Pure. */
export const credentialLinksPayload = () => ({
  providers: Object.fromEntries(
    [...new Set([...Object.keys(PROVIDER_KEY_PAGES), ...Object.keys(PROVIDER_DOCS)])].map((id) => [id, providerKeyLink(id)]),
  ),
  ...CREDENTIAL_LINKS,
});
