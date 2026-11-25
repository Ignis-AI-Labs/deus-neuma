/**
 * THE EXTENSION CATALOG — MCP servers a house may add, each one third-party
 * code that will run on this computer and act for a being. So every entry is
 * held to the same bar, checked against the npm registry when it was added
 * (2026-11-12) and kept honest by test/integration/extension-catalog-registry.test.js:
 *
 *   - published by the service's own organization (its repository lives there),
 *   - a stable release, not deprecated, pinned to one exact version,
 *   - run from its own entry file (`bin`), never through `npx`,
 *   - what it reaches and the keys it reads, written down here.
 *
 * `overrides` lifts a library inside an extension to its patched release, only
 * ever within the same major version, when the extension's own pin carries a
 * known flaw the vendor has not shipped a fix for yet. The check still runs on
 * the result. `held` keeps an entry listed but not installable: its newest
 * release fails the check and no same-major fix exists. Both were measured by
 * installing and checking every entry (2026-11-12); a held entry is promoted
 * by moving its pin once the vendor ships a clean release.
 *
 * Being listed is not trust. Nothing in this catalog runs until it has been
 * installed with install scripts off and passed the security check
 * (extension-install.js), and the daily watch re-checks it after that.
 *
 * Pure data.
 */

const entry = (fields) => Object.freeze({ args: Object.freeze([]), env: Object.freeze([]), fixedEnv: Object.freeze({}), ...fields });
const key = (name, label, { required = true } = {}) => Object.freeze({ name, label, required });

export const EXTENSIONS = Object.freeze([
  entry({ id: 'memory', name: 'Memory (knowledge graph)', publisher: 'Model Context Protocol', package: '@modelcontextprotocol/server-memory', version: '2.1.1', bin: 'dist/index.js',
    repository: 'https://github.com/modelcontextprotocol/servers', reaches: 'nothing outside this computer', does: 'a small knowledge graph the being can write to and query',
    fixedEnv: Object.freeze({ MEMORY_FILE_PATH: '{dir}/memory.jsonl' }) }),
  entry({ id: 'sequential-thinking', name: 'Sequential thinking', publisher: 'Model Context Protocol', package: '@modelcontextprotocol/server-sequential-thinking', version: '2.1.1', bin: 'dist/index.js',
    repository: 'https://github.com/modelcontextprotocol/servers', reaches: 'nothing outside this computer', does: 'step-by-step reasoning the being can revise and branch' }),
  entry({ id: 'playwright', name: 'Playwright browser', publisher: 'Microsoft', package: '@playwright/mcp', version: '0.0.85', bin: 'cli.js',
    repository: 'https://github.com/microsoft/playwright-mcp', reaches: 'whatever sites the being opens, in a browser on this computer (needs Chrome installed)',
    does: 'drive a real browser: open pages, click, type, read', args: Object.freeze(['--headless', '--isolated']) }),
  entry({ id: 'notion', name: 'Notion', publisher: 'Notion', package: '@notionhq/notion-mcp-server', version: '2.6.1', bin: 'bin/cli.mjs',
    repository: 'https://github.com/makenotion/notion-mcp-server', reaches: 'api.notion.com', does: 'read and write the Notion pages and databases your integration can see',
    env: Object.freeze([key('NOTION_TOKEN', 'Notion integration token')]) }),
  entry({ id: 'context7', name: 'Context7 docs', publisher: 'Upstash', package: '@upstash/context7-mcp', version: '4.7.0', bin: 'dist/index.js',
    repository: 'https://github.com/upstash/context7', reaches: 'context7.com', does: 'current documentation for libraries, by name and version',
    env: Object.freeze([key('CONTEXT7_API_KEY', 'Context7 API key (optional, raises the limits)', { required: false })]) }),
  entry({ id: 'supabase', name: 'Supabase', publisher: 'Supabase', package: '@supabase/mcp-server-supabase', version: '0.16.1', bin: 'dist/cli.js',
    repository: 'https://github.com/supabase/mcp', reaches: 'api.supabase.com', does: 'inspect your Supabase projects, tables and logs (read-only)',
    args: Object.freeze(['--read-only']), env: Object.freeze([key('SUPABASE_ACCESS_TOKEN', 'Supabase personal access token')]) }),
  entry({ id: 'brave-search', name: 'Brave Search', publisher: 'Brave', package: '@brave/brave-search-mcp-server', version: '2.1.4', bin: 'dist/index.js',
    repository: 'https://github.com/brave/brave-search-mcp-server', reaches: 'api.search.brave.com', does: 'web, news and image search',
    overrides: Object.freeze({ '@modelcontextprotocol/sdk': '^1.32.0', zod: '^4.6.6' }),
    env: Object.freeze([key('BRAVE_API_KEY', 'Brave Search API key')]) }),
  entry({ id: 'firecrawl', held: 'its newest release fails the security check: zod 3.25.76 (GHSA-mrhx-c7xc-m3w5, high); the fix is zod 4, a major version', name: 'Firecrawl', publisher: 'Firecrawl', package: 'firecrawl-mcp', version: '3.40.0', bin: 'dist/index.js',
    repository: 'https://github.com/firecrawl/firecrawl-mcp-server', reaches: 'api.firecrawl.dev', does: 'scrape and crawl sites into clean text',
    env: Object.freeze([key('FIRECRAWL_API_KEY', 'Firecrawl API key')]) }),
  entry({ id: 'exa', held: 'its newest release fails the security check: the MCP SDK 1.26 (four high advisories) and zod 3.25.76 (GHSA-mrhx-c7xc-m3w5); the zod fix is a major version', name: 'Exa search', publisher: 'Exa', package: 'exa-mcp-server', version: '3.4.3', bin: 'dist/stdio.cjs',
    repository: 'https://github.com/exa-labs/exa-mcp-server', reaches: 'api.exa.ai', does: 'semantic web search and page contents',
    env: Object.freeze([key('EXA_API_KEY', 'Exa API key')]) }),
  entry({ id: 'tavily', name: 'Tavily search', publisher: 'Tavily', package: 'tavily-mcp', version: '0.2.22', bin: 'build/index.js',
    repository: 'https://github.com/tavily-ai/tavily-mcp', reaches: 'api.tavily.com', does: 'search and extract for research',
    overrides: Object.freeze({ '@modelcontextprotocol/sdk': '^1.32.0' }),
    env: Object.freeze([key('TAVILY_API_KEY', 'Tavily API key')]) }),
  entry({ id: 'mongodb', held: 'its newest release fails the security check: basic-ftp 5.3.1 (GHSA-c475-qrg2-pj4r, high); the fix is basic-ftp 6, a major version', name: 'MongoDB', publisher: 'MongoDB', package: 'mongodb-mcp-server', version: '3.3.0', bin: 'dist/esm/index.js',
    repository: 'https://github.com/mongodb-js/mongodb-mcp-server', reaches: 'the MongoDB your connection string names', does: 'query your MongoDB collections (read-only)',
    fixedEnv: Object.freeze({ MDB_MCP_READ_ONLY: 'true' }), env: Object.freeze([key('MDB_MCP_CONNECTION_STRING', 'MongoDB connection string')]) }),
  entry({ id: 'heroku', name: 'Heroku', publisher: 'Heroku', package: '@heroku/mcp-server', version: '1.2.14', bin: 'bin/heroku-mcp-server.mjs',
    repository: 'https://github.com/heroku/heroku-mcp-server', reaches: 'api.heroku.com', does: 'manage your Heroku apps, dynos and add-ons',
    env: Object.freeze([key('HEROKU_API_KEY', 'Heroku API key')]) }),
  entry({ id: 'netlify', held: 'its newest release fails the security check: extract-zip 2.0.1 (GHSA-7pqw-9j4j-h8q3, high), which has no fix, among eleven high or critical findings', name: 'Netlify', publisher: 'Netlify', package: '@netlify/mcp', version: '1.21.0', bin: 'dist/netlify-mcp.js',
    repository: 'https://github.com/netlify/netlify-mcp', reaches: 'api.netlify.com', does: 'create, deploy and manage Netlify sites',
    env: Object.freeze([key('NETLIFY_PERSONAL_ACCESS_TOKEN', 'Netlify personal access token')]) }),
  entry({ id: 'apify', held: 'its newest release fails the security check: basic-ftp 5.3.1 (GHSA-c475-qrg2-pj4r, high); the fix is basic-ftp 6, a major version', name: 'Apify', publisher: 'Apify', package: '@apify/actors-mcp-server', version: '0.21.6', bin: 'dist/stdio.js',
    repository: 'https://github.com/apify/apify-mcp-server', reaches: 'api.apify.com', does: 'run Apify scrapers and automation actors',
    env: Object.freeze([key('APIFY_TOKEN', 'Apify API token')]) }),
  entry({ id: 'sentry', name: 'Sentry', publisher: 'Sentry', package: '@sentry/mcp-server', version: '0.49.0', bin: 'dist/sentry-mcp.cjs',
    repository: 'https://github.com/getsentry/toolkit', reaches: 'sentry.io', does: 'read your Sentry issues, errors and releases',
    env: Object.freeze([key('SENTRY_ACCESS_TOKEN', 'Sentry user auth token')]) }),
  entry({ id: 'perplexity', held: 'its newest release fails the security check: zod 3.25.76 (GHSA-mrhx-c7xc-m3w5, high); the fix is zod 4, a major version', name: 'Perplexity', publisher: 'Perplexity', package: '@perplexity-ai/mcp-server', version: '1.3.0', bin: 'dist/index.js',
    repository: 'https://github.com/perplexityai/modelcontextprotocol', reaches: 'api.perplexity.ai', does: 'answers with web citations',
    env: Object.freeze([key('PERPLEXITY_API_KEY', 'Perplexity API key')]) }),
  entry({ id: 'launchdarkly', name: 'LaunchDarkly', publisher: 'LaunchDarkly', package: '@launchdarkly/mcp-server', version: '0.7.2', bin: 'bin/mcp-server.js',
    repository: 'https://github.com/launchdarkly/mcp-server', reaches: 'app.launchdarkly.com', does: 'read and change feature flags',
    args: Object.freeze(['start']), env: Object.freeze([key('LAUNCHDARKLY_API_KEY', 'LaunchDarkly API access token')]) }),
  entry({ id: 'mapbox', name: 'Mapbox', publisher: 'Mapbox', package: '@mapbox/mcp-server', version: '0.18.0', bin: 'dist/esm/index.js',
    repository: 'https://github.com/mapbox/mcp-server', reaches: 'api.mapbox.com', does: 'geocoding, directions and maps',
    env: Object.freeze([key('MAPBOX_ACCESS_TOKEN', 'Mapbox access token')]) }),
  entry({ id: 'pinecone', name: 'Pinecone', publisher: 'Pinecone', package: '@pinecone-database/mcp', version: '0.4.0', bin: 'dist/index.js',
    repository: 'https://github.com/pinecone-io/pinecone-mcp', reaches: 'api.pinecone.io', does: 'search and manage your Pinecone vector indexes',
    env: Object.freeze([key('PINECONE_API_KEY', 'Pinecone API key')]) }),
]);

const BY_ID = new Map(EXTENSIONS.map((e) => [e.id, e]));

/** The catalog entry for an id, or null. Pure. */
export const extensionById = (id) => BY_ID.get(String(id || '')) ?? null;

/** What a person is told before adding any extension. */
export const THIRD_PARTY_NOTE = 'An extension is third-party code that runs on this computer and acts for your beings. '
  + 'Each one is checked against the OSV vulnerability database before it can run and again every day; '
  + 'keep only the ones you use, update them when the check asks you to, and remove any you no longer trust.';
