import fs from 'node:fs/promises';
import path from 'node:path';

// impure — create only the mountpoints inspect needs; callers remove only these.
export const prepareLiveInspectMounts = async (places) => {
  const created = [];
  for (const place of places) {
    let current = place;
    const missing = [];
    while (current !== path.dirname(current)) {
      const exists = await fs.lstat(current).then(() => true, () => false);
      if (exists) break;
      missing.push(current);
      current = path.dirname(current);
    }
    if (missing.length) {
      await fs.mkdir(place, { recursive: true });
      created.push(...missing);
    }
  }
  return created.sort((a, b) => b.length - a.length);
};

// impure — rmdir, never rm: anything written by another process stays in place.
export const cleanupLiveInspectMounts = async (created) => {
  for (const place of created) {
    await fs.rmdir(place).catch((error) => {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    });
  }
};
