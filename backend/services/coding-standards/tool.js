/** The existing architecture reader also reads the standards behind that architecture. */
import { readStandardsBundle } from './bundle.js';

/** impure — named module only; no model-controlled filesystem path is accepted. */
export const readStandardTool = async (args, emit) => {
  const tool = 'map/read_architecture';
  try {
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).length !== 1 || typeof args.standard !== 'string') {
      throw new Error('Use {"standard":"NAME"} alone to read a coding standard.');
    }
    const { manifest, documents } = await readStandardsBundle();
    const core = args.standard === 'CORE';
    if (!core && !Object.hasOwn(documents, args.standard)) throw new Error('Unknown coding standard. Use a name from the module routing table.');
    const body = core ? manifest.core.map((name) => documents[name]).join('\n\n') : documents[args.standard];
    const content = `Ignis ${manifest.version} · ${args.standard} · sha256:${core ? manifest.sourceDigest : manifest.files[args.standard]}\n\n${body}`;
    emit({ status: 'ok', summary: `Coding standard: ${args.standard}` });
    return { tool, status: 'ok', content };
  } catch {
    const error = 'Coding standard unavailable or invalid selection. Use one listed standard name; if the package is damaged, restore the reviewed app package before coding.';
    emit({ status: 'error', summary: 'Coding standard read refused', detail: error });
    return { tool, status: 'error', error };
  }
};
