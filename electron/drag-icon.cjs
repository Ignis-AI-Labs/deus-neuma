// The drag-out ghost, painted in-process (the repo ships no PNG): a 32×32
// document glyph — signal-cyan edge, near-white page, folded corner — so an
// Explorer row's OS-level drag carries the house's look. BGRA bytes, built
// once.
//
// Split out of main.cjs (SIZE-020); consumed by ipc-handlers.cjs
// (`files:start-drag`).

const { nativeImage } = require('electron');

const dragIcon = (() => {
  let cached = null;
  return () => {
    if (cached) return cached;
    const W = 32; const H = 32;
    const px = Buffer.alloc(W * H * 4, 0);
    const put = (x, y, b, g, r, a = 255) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = (y * W + x) * 4;
      px[i] = b; px[i + 1] = g; px[i + 2] = r; px[i + 3] = a;
    };
    for (let y = 3; y <= 28; y += 1) {
      for (let x = 7; x <= 24; x += 1) {
        const inFold = x > 17 && y < 10 && (x - 17) > (10 - y);
        if (inFold) continue; // the folded corner reads as cut paper
        const onFoldEdge = x > 17 && y < 10 && (x - 17) === (10 - y);
        const edge = x === 7 || x === 24 || y === 3 || y === 28 || onFoldEdge;
        // #5FE9FF edge (--signal), near-white page.
        if (edge) put(x, y, 0xFF, 0xE9, 0x5F);
        else put(x, y, 0xF2, 0xF2, 0xF2);
      }
    }
    cached = nativeImage.createFromBitmap(px, { width: W, height: H });
    return cached;
  };
})();

module.exports = { dragIcon };
