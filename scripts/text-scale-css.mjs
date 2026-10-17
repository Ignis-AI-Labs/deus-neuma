/** Scale fixed typography at compilation so lazy-loaded CSS follows LOOK too. */
export const textScaleCss = () => ({
  postcssPlugin: 'neuma-text-scale',
  // Exit avoids revisiting declarations containing the generated calc().
  OnceExit(root) {
    root.walkDecls(/^(font-size|font|line-height)$/, (decl) => {
      if (decl.source?.input.file?.includes('node_modules')) return;
      decl.value = decl.value.replace(/\b(\d*\.?\d+)(px|vw|vh|vmin|vmax)\b/g,
        (size) => `calc(${size} * var(--text-scale, 1))`);
    });
  },
});
