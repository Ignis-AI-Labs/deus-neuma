// args.mjs — the one flag reader the bake-off scripts share: `--name value`.
export const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
