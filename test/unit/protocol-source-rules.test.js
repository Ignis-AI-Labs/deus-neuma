/** #383: real classifier calls distinguish explanatory text from code. */
import { beforeEach, afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import { withProtocolReminders } from '../../backend/services/protocol-classifier.js';

let previous;
beforeEach(() => {
  previous = process.env.NEUMA_PROTOCOL_REMINDERS;
  delete process.env.NEUMA_PROTOCOL_REMINDERS;
});
afterEach(() => {
  if (previous === undefined) delete process.env.NEUMA_PROTOCOL_REMINDERS;
  else process.env.NEUMA_PROTOCOL_REMINDERS = previous;
});
const classify = (path, content) => withProtocolReminders('ok', [
  { tool: 'filesystem/write_file', args: { path, content } },
]);

test.each([
  'core/silo/mount-silo.js',
  'frontend/app/RelinkShell/NotificationTray/NotificationTray.jsx',
])('current source %s earns no comment-driven reminder', (file) => {
  expect(classify(file, fs.readFileSync(file, 'utf8'))).toBe('ok');
});

test.each([
  "// import x from '../backend/x.js'",
  "/* never imports from `backend/` */",
  'const example = "import x from \'../backend/x.js\'";',
  'const example = `import x from "../backend/x.js"`;',
  "import x from './safe.js'; // not from 'backend/'",
])('architecture ignores non-import text: %s', (content) => {
  expect(classify('core/example.js', content)).toBe('ok');
});

test.each([
  "import x from '../backend/x.js';",
  "import {\n x\n} /* reason */ from '../backend/x.js';",
  "import '../backend/x.js';",
  "const x = require('../backend/x.js');",
  "const x = import('../backend/x.js');",
  "export * from '../backend/x.js';",
  'const x = `${await import("../backend/x.js")}`;',
])('architecture still detects executable dependency: %s', (content) => {
  expect(classify('core/example.js', content)).toContain('R-ARCH-01');
});

test.each([
  '// no dangerouslySetInnerHTML here',
  '/* dangerouslySetInnerHTML is prohibited */',
  'const text = "dangerouslySetInnerHTML";',
  'const text = `dangerouslySetInnerHTML`;',
])('HTML rule ignores prose: %s', (content) => {
  expect(classify('frontend/example.jsx', content)).toBe('ok');
});

test.each([
  'const view = <div dangerouslySetInnerHTML={{ __html: input }} />;',
  '/* safely rendered elsewhere */ const props = { dangerouslySetInnerHTML: input };',
  'const text = `${props.dangerouslySetInnerHTML}`;',
  'const props = { "dangerouslySetInnerHTML": input };',
  'props["dangerouslySetInnerHTML"] = input;',
])('HTML rule detects executable use: %s', (content) => {
  expect(classify('frontend/example.jsx', content)).toContain('R-XSS-01');
});
