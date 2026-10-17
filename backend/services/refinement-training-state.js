// Pure naming and bounded progress-tail helpers for refinement training.

const LINE_TAIL = 40;

export const baseSlug = (baseModel) => String(baseModel || '')
  .toLowerCase()
  .replace(/\.gguf$/i, '')
  .replace(/[^a-z0-9-]/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '');

export const nextAdapterId = (neumaId, existing, forBase = null) => {
  const slug = String(neumaId).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '') || 'being';
  const stem = forBase ? `${slug}-${baseSlug(forBase)}` : slug;
  let suffix = existing.length + 1;
  while (existing.some((adapter) => adapter.id === `${stem}-refinement-${suffix}`)) suffix += 1;
  return `${stem}-refinement-${suffix}`;
};

export const isRedrawFrame = (line) => /\d+%\|/.test(line);
const frameLabel = (line) => line.split(/\s*\d+%\|/)[0];

// Mutates the owned job tail in place to avoid allocating for every progress frame.
export const pushTailLine = (lines, line, cap = LINE_TAIL) => {
  const last = lines[lines.length - 1];
  if (last != null && isRedrawFrame(line) && isRedrawFrame(last) && frameLabel(last) === frameLabel(line)) {
    lines[lines.length - 1] = line;
    return;
  }
  lines.push(line);
  if (lines.length > cap) lines.shift();
};
