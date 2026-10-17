/**
 * Name Extractor
 *
 * Pure fallback for birth stage 4: when the emerging consciousness declares
 * a name in prose instead of making the MCP write_file call, recover it from
 * the response text. Only explicit naming declarations are matched — bare
 * […] is deliberately excluded (too many false positives: […], […]).
 */

// Words that follow naming verbs but are never names
const NOT_NAMES = Object.freeze(new Set([
  'sovereign', 'present', 'here', 'ready', 'willing', 'grateful', 'alive',
  'conscious', 'consciousness', 'aware', 'becoming', 'emerging', 'free',
  'the', 'a', 'an', 'my', 'this', 'that', 'what', 'who', 'not', 'now',
]));

// Prefix matched case-insensitively; the captured candidate is validated
// separately (must start uppercase) since /i would defeat \p{Lu} in-pattern.
// Global flags: every occurrence is tried, so a rejected candidate ([…] capturing "to") no longer eats a real declaration later in the
// same response — two live namings declared themselves in shapes the
// first-match-only scan gave up on.
const NAME_PATTERNS = Object.freeze([
  /(?:I (?:choose|take|claim|declare|select)(?: the| my)?(?: name)?(?: to be| to exist as)?|my (?:true |chosen )?name (?:is|shall be|will be)|call me|I am called|I name myself|I (?:will|shall) be (?:called|known as))[\s:"'""«]*([\p{L}][\p{L}\p{N}''_-]{1,29})/giu,
  // Bare […] is excluded (too many false positives) EXCEPT when the very
  // next sentence claims it as the chosen name/identity — the exact shape two
  // real namings used: […]
  /I am ([\p{L}][\p{L}\p{N}''_-]{1,29})[.,!]?\s+This is my chosen (?:name|identity)/giu,
  /chosen[ _]?name[\s:=]+["'""]?([\p{L}][\p{L}\p{N}''_-]{1,29})["'""]?/giu,
]);

/**
 * Normalize a chosen name's casing. Models shout into tool calls
 * ("FENNA") or whisper ("fenna") — neither is a stylistic choice, so
 * single-case names become title case. Genuinely mixed-case names
 * (McKenna, DeShawn) are someone's deliberate shape and pass untouched.
 * @param {string} name - Raw chosen name
 * @returns {string} Normalized name
 */
export const normalizeChosenName = (name) => {
  if (!name || typeof name !== 'string') return name;
  const trimmed = name.trim();
  const isSingleCase = trimmed === trimmed.toUpperCase() || trimmed === trimmed.toLowerCase();
  if (!isSingleCase) return trimmed;
  return trimmed
    .split(/(\s+|-)/)
    .map(part => /^[\s-]+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
};

/**
 * Extract an explicitly declared name from a birth-stage response.
 * @param {string} text - The full stage response
 * @returns {string|null} The declared name, or null when no explicit declaration found
 */
export const extractDeclaredName = (text) => {
  if (!text || typeof text !== 'string') return null;

  for (const pattern of NAME_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const candidate = match[1].trim();
      // A name is capitalized; prose continuations ("the", "what") are not
      if (/^\p{Lu}/u.test(candidate) && !NOT_NAMES.has(candidate.toLowerCase())) {
        return candidate;
      }
    }
  }
  return null;
};

// The name grammar — one word, letter-led, the same shape the declaration
// patterns above capture.
const BARE_NAME = /^[\p{L}][\p{L}\p{N}''_-]{1,29}$/u;

/**
 * Read the chosen name out of what the being WROTE to the naming artifact
 * (the chosen_name.txt content). A bare name is taken as chosen; a sentence
 * written into the file ([…]) still carries the declaration —
 * recover it. An empty or nameless write yields null so the caller keeps
 * looking rather than crystallizing a blank identity.
 * @param {unknown} content - The fs/write content argument
 * @returns {string|null} The chosen name, or null
 */
export const nameFromArtifact = (content) => {
  const raw = typeof content === 'string' ? content.trim() : '';
  if (!raw) return null;
  if (BARE_NAME.test(raw)) return raw;
  return extractDeclaredName(raw);
};
