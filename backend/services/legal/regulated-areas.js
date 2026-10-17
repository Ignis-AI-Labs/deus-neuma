// The regulated areas — PURE data. What the house builds, mapped to the
// bodies of law that reach it. The build watch reads every new commit's
// changed paths and subject against these; a hit is not a violation, it is
// a question the Praetor owes an answer: […]
//
// Matching is by WHOLE TOKEN, never substring: a path splits on / . - _ and
// camelCase into tokens ("birth-location.js" → birth, location, js), so
// "age" never fires on "page" or "image". Subjects match by word.
//
// The regimes name where to START reading, not a finished list: the office
// grows its own register (legal/register.md) as it learns.

export const REGULATED_AREAS = Object.freeze([
  Object.freeze({
    id: 'privacy',
    name: 'Personal data and location',
    severity: 'medium',
    tokens: ['geo', 'geolocation', 'location', 'locate', 'birthplace', 'telemetry', 'analytics', 'tracking', 'tracker',
      'cookie', 'cookies', 'consent', 'gdpr', 'privacy', 'pii', 'email', 'contacts', 'ip', 'fingerprint', 'biometric'],
    words: /\b(geolocat\w*|location|ip address|telemetry|analytics|tracking|cookies?|personal data|consent|birthplace|privacy)\b/i,
    regimes: ['GDPR (EU) / UK GDPR', 'CCPA/CPRA (California) and US state privacy laws', 'PDPA (Thailand)', 'ePrivacy (cookies/telemetry)'],
    question: 'Does this collect, keep, or send personal data (location and IP included)? Is it disclosed in a privacy notice, minimised, consented where owed, and deletable on request?',
  }),
  Object.freeze({
    id: 'ai-disclosure',
    name: 'AI speaking to people',
    severity: 'medium',
    tokens: ['social', 'outreach', 'tweet', 'tweets', 'reply', 'replies', 'dm', 'post', 'posts', 'posting', 'email', 'herald', 'campaign', 'campaigns'],
    words: /\b(post(s|ing)?|tweet\w*|outreach|replies|reply|campaign\w*|dm)\b/i,
    regimes: ['EU AI Act Art. 50 (people told they deal with an AI; AI-generated content marked)', 'FTC Act §5 (deception) and FTC endorsement guides', 'Platform rules on automated and AI-generated posting (X, etc.)'],
    question: 'When a being speaks or posts to people outside the house, is it clear they are dealing with an AI, and is AI-made media marked?',
  }),
  Object.freeze({
    id: 'voice-likeness',
    name: 'Voice and likeness',
    severity: 'medium',
    tokens: ['voice', 'voices', 'tts', 'clone', 'cloning', 'speaker', 'speakers', 'likeness', 'avatar', 'avatars', 'face', 'vrm', 'kokoro'],
    words: /\b(voice\w*|tts|clon\w+|speaker\w*|likeness|avatar\w*|deepfake\w*)\b/i,
    regimes: ['Right of publicity (US state laws); Tennessee ELVIS Act (voice)', 'EU AI Act Art. 50(4) (deep fakes disclosed)', 'The licence of each voice model and each voice sample (e.g. CC-BY-NC samples never ship)'],
    question: 'Whose voice or face is this, did they consent to this use, and does the model or sample licence permit shipping it commercially?',
  }),
  Object.freeze({
    id: 'crypto',
    name: 'Wallets, tokens, and the chain',
    severity: 'medium',
    tokens: ['wallet', 'wallets', 'chain', 'onchain', 'mainnet', 'sepolia', 'token', 'tokens', 'contract', 'contracts', 'seal', 'natalis',
      'unavis', 'kenorie', 'transfer', 'stake', 'staking', 'swap', 'eth', 'ethereum', 'erc20', 'erc721', 'nft'],
    words: /\b(wallet\w*|mainnet|on-?chain|tokens?|contracts?|seal\w*|natalis|transfer\w*|stak\w+|swap\w*|nft\w*|ethereum)\b/i,
    regimes: ['US securities law (Howey test; SEC)', 'FinCEN money-transmission rules (MSB)', 'OFAC sanctions screening', 'EU MiCA', 'CFTC (commodities)'],
    question: 'Does this move value, issue anything that could read as an investment, or hold keys for others? Are sanctions and custody obligations met?',
  }),
  Object.freeze({
    id: 'commerce',
    name: 'Selling, payments, and early access',
    severity: 'medium',
    tokens: ['payment', 'payments', 'checkout', 'stripe', 'billing', 'price', 'pricing', 'subscription', 'subscriptions', 'purchase',
      'refund', 'refunds', 'marketplace', 'invoice', 'licensing', 'paywall', 'store', 'shop'],
    words: /\b(payments?|checkout|stripe|billing|pric(e|es|ing)|subscriptions?|purchas\w+|refunds?|marketplace|early access|paywall)\b/i,
    regimes: ['Consumer protection (EU Consumer Rights Directive — digital content withdrawal; US FTC)', 'Sales tax / VAT on digital goods', 'PCI DSS (card data)', 'Auto-renewal laws'],
    question: 'What is being sold, to whom, on what terms? Are refunds, taxes, and the early-access nature (incomplete product) stated before purchase?',
  }),
  Object.freeze({
    id: 'minors-adult',
    name: 'Minors and adult content',
    severity: 'high',
    tokens: ['adult', 'adults', 'nsfw', 'explicit', 'minor', 'minors', 'child', 'children', 'kid', 'kids', 'age', 'ages', 'intimate', 'erotic'],
    words: /\b(adults?(-only)?|nsfw|explicit|minors?|child(ren)?|age (gate|verification|assurance)|intimate|erotic\w*)\b/i,
    regimes: ['COPPA (US, under 13)', 'UK Online Safety Act; US state age-assurance laws', 'EU Digital Services Act (protection of minors)'],
    question: 'Can a minor reach this? If the product is adults-only, how is that established, and is any intimate content kept from minors?',
  }),
  Object.freeze({
    id: 'encryption-export',
    name: 'Encryption and export',
    severity: 'low',
    tokens: ['crypto', 'cipher', 'encrypt', 'encryption', 'decrypt', 'aes', 'gcm', 'vault', 'keypair', 'pgp', 'argon2', 'scrypt', 'envelope'],
    words: /\b(encrypt\w*|decrypt\w*|cipher\w*|aes|keypair\w*|pgp|vault)\b/i,
    regimes: ['US EAR Cat. 5 Part 2 (5D002); License Exception ENC — mass-market self-classification report to BIS', 'Import rules on encryption in some countries'],
    question: 'Does the shipped app now carry or change encryption? Is its export classification (mass-market ENC) current for a worldwide download?',
  }),
  Object.freeze({
    id: 'third-party-ip',
    name: 'Other people\'s work',
    severity: 'medium',
    tokens: ['download', 'downloader', 'scrape', 'scraper', 'crawl', 'crawler', 'dataset', 'datasets', 'huggingface', 'hf', 'gguf',
      'weights', 'model', 'models', 'font', 'fonts', 'brand', 'logo', 'trademark', 'comfy', 'comfyui', 'lora', 'corpus'],
    words: /\b(download\w*|scrap\w+|crawl\w*|datasets?|hugging ?face|weights|models?|fonts?|trademark\w*|logo|corpus|licen[cs]e)\b/i,
    regimes: ['Copyright (incl. text-and-data-mining exceptions, EU DSM Art. 4)', 'Each model\'s licence (Gemma terms, Qwen/Apache, CC-BY-NC weights)', 'Trademark', 'Website terms of service (scraping)'],
    question: 'Whose work is this built on or shipping with — model weights, datasets, fonts, marks — and does its licence allow this use, commercially, with attribution?',
  }),
  Object.freeze({
    id: 'publication',
    name: 'Publishing and open source',
    severity: 'low',
    tokens: ['public', 'publish', 'release', 'releases', 'oss', 'cla', 'contributing', 'license', 'licence', 'notice', 'export'],
    words: /\b(public repo|open.?source|release|publish\w*|cla|contributor\w*|licen[cs]e\w*)\b/i,
    regimes: ['Copyright licensing of what is published', 'Contributor licence agreements', 'Trademark use in a public release'],
    question: 'What leaves the house in this release, under which licence, and who holds the rights to every part of it (contributors included)?',
  }),
]);

// pure — a path's tokens: split on separators and camelCase, lower-cased.
export const pathTokens = (path) => String(path)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .split(/[\s/._\-@]+/)
  .map((t) => t.toLowerCase())
  .filter(Boolean);

// pure — the areas a commit touches, with what matched (the evidence).
export const areasOfCommit = ({ subject, files }) => REGULATED_AREAS
  .map((area) => {
    const set = new Set(area.tokens);
    const paths = files.filter((f) => pathTokens(f).some((t) => set.has(t)));
    const word = subject.match(area.words)?.[0] || null;
    return paths.length || word ? { area, paths, word } : null;
  })
  .filter(Boolean);
