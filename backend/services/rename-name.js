/** Refuse invalid rename targets without rewriting legal filename bytes. Pure. */
export const assertRenameName = (name, platform) => {
  if (!name.trim()) throw new Error('A filename cannot be empty or whitespace-only.');
  if (platform === 'win32' && /[ .]$/.test(name)) {
    throw new Error('Windows cannot store a name ending in a space or a dot.');
  }
};
