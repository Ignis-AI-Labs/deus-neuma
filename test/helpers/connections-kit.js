// connections-kit — turn CONNECTIONS switches on for one suite, on a real temp file (the
// NEUMA_CONNECTIONS_PATH isolation door), never the machine's own switches. Every connection that
// runs by itself is off until turned on, so a suite that proves the online path says so here.
//
// impure — writes a temp file and sets an env var; `restore` puts both back.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * @param {string[]} ids - the connections this suite needs on
 * @returns {{file: string, restore: () => void}}
 */
export const connectionsOn = (ids) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-connections-'));
  const file = path.join(dir, 'connections.json');
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(ids.map((id) => [id, true]))));
  const prior = process.env.NEUMA_CONNECTIONS_PATH;
  process.env.NEUMA_CONNECTIONS_PATH = file;
  const restore = () => {
    if (prior === undefined) delete process.env.NEUMA_CONNECTIONS_PATH;
    else process.env.NEUMA_CONNECTIONS_PATH = prior;
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { file, restore };
};
