import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import legacy from './.eslintrc.cjs';

// The approved integration gate checks correctness without a formatting sweep.
// Keep its environment and rule declarations in the existing shared config.
const compat = new FlatCompat({
  baseDirectory: path.dirname(fileURLToPath(import.meta.url)),
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default compat.config(legacy);
