// Local-only path shapes for the privileged Electron opener boundary.

const isUncPath = (value) => typeof value === 'string' && /^[\\/]{2}/.test(value);

const withinRoot = (path, root, pathModule) => {
  const relative = pathModule.relative(pathModule.resolve(root), pathModule.resolve(path));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${pathModule.sep}`) && !pathModule.isAbsolute(relative));
};

module.exports = { isUncPath, withinRoot };
