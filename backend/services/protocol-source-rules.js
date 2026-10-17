/** Source predicates share mapview's comment/string mask and module reader. */
import { maskNonCode } from './mapview/extract.js';
import { extractModuleRefs } from './mapview/imports.js';

/** Pure — inspect real module references, not quoted examples in prose. */
export const importsFromFolder = (content, folder) =>
  extractModuleRefs(content, maskNonCode(content), '/source.js', '/')
    .some(({ spec }) => spec.split('/').includes(folder));

/** Pure — comments and literal prose cannot impersonate executable properties. */
export const usesRawHtmlProperty = (content) => {
  const masked = maskNonCode(content);
  if (/\bdangerouslySetInnerHTML\b/.test(masked)) return true;
  // Quoted object keys and bracket access still name a real property.
  for (const match of masked.matchAll(/(['"])[^'"\n]*\1/g)) {
    const start = match.index;
    const end = start + match[0].length;
    if (content.slice(start + 1, end - 1) !== 'dangerouslySetInnerHTML') continue;
    const after = masked.slice(end).trimStart();
    if (after.startsWith(':')) return true;
    if (masked.slice(0, start).trimEnd().endsWith('[') && after.startsWith(']')) return true;
  }
  return false;
};
