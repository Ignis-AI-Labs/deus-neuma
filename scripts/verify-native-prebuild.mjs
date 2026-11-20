#!/usr/bin/env node
// Refuse an unreviewed native prebuild before it can enter an installer. impure (filesystem).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

export const verifyNativePrebuild = ({ file, expectedSha256 }) => {
  if (!/^[0-9a-f]{64}$/.test(String(expectedSha256 ?? ''))) return `no reviewed SHA-256 pin for ${path.basename(file)}`;
  if (!fs.existsSync(file)) return `the downloaded native binary is absent: ${file}`;
  const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return actual === expectedSha256 ? null : `${path.basename(file)} has SHA-256 ${actual}, not the reviewed ${expectedSha256}`;
};

const main = () => {
  const { values } = parseArgs({ options: { file: { type: 'string' }, electron: { type: 'string' }, platform: { type: 'string' }, arch: { type: 'string' } } });
  const pins = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./native-prebuild-pins.json', import.meta.url)), 'utf8'));
  const expected = pins[values.electron]?.[`${values.platform}-${values.arch}`] ?? null;
  const problem = verifyNativePrebuild({ file: values.file, expectedSha256: expected });
  if (problem) throw new Error(problem);
  process.stdout.write(`${values.file}: reviewed SHA-256 holds\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`native prebuild refused: ${error.message}\n`); process.exit(1); }
}
