// Local-only path shapes shared by the filesystem picker and root grant.
// UNC is a network location, never a local desk root.

export const isUncPath = (value) => typeof value === 'string' && /^[\\/]{2}/.test(value);

export const hasDotSegment = (value) => typeof value === 'string'
  && value.split(/[\\/]/).some((segment) => segment === '.' || segment === '..');
