// Where the witness-reviewed content law lives (gitignored by law). Its own small file so every reader of the
// law — the image tools, the intents, the engine tools — can name it without importing one another.
import path from 'node:path';
import { getDataRoot } from '../data-root.js';

export const contentLawPath = (env = process.env) =>
  env.COMFYUI_CONTENT_LAW_PATH || path.join(getDataRoot(), 'image-forge', 'content-law.json');
