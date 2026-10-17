// One element, made the safe way: a class and plain text (textContent, never
// markup). Shared by the vanilla ceremony panels. Impure (creates a DOM node).
export const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
