/** Shared local algorithm clone locations and machine receipt path. */
import path from 'node:path';

export const ALGORITHM_REPOS = Object.freeze({
  ranking: '/workspace/repos/project-mogofam',
  ml: '/workspace/repos/project-ketatol',
});

/** impure — environment selects the runtime data root. */
export const algorithmSyncStampPath = () => path.join(
  process.env.NEUMA_DATA_ROOT || path.join(process.cwd(), 'data'), 'x-algorithm-sync.json',
);
