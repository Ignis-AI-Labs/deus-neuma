// company-tree — the house's companies as TREES (campaign plan §2.3, decided
// 2026-10-23). A core company heads its subsidiaries; a client company with
// no parent is its own tree. A tree's numbers roll up within the tree only,
// and nothing (a post group, a sum) ever spans two trees.
//
// Pure. The companies come from the house's brand kits (companies.js).

/**
 * Each company with its tree settled: a parent that names no company of this
 * house, or a parent chain that loops, makes the company a top-level one, with
 * the reason named (never a silent re-parent). Pure.
 * @param {ReadonlyArray<{id: string, parentId: ?string}>} companies
 * @returns {Array<object & {parentId: ?string, rootId: string, depth: number, problem: ?string}>}
 */
export const settleTree = (companies) => {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const settled = new Map();
  const settle = (company) => {
    if (settled.has(company.id)) return settled.get(company.id);
    const chain = [company.id];
    let cursor = company;
    let problem = null;
    while (cursor.parentId) {
      const parent = byId.get(cursor.parentId);
      if (!parent) { problem = `its parent "${cursor.parentId}" is not a company of this house`; break; }
      if (chain.includes(parent.id)) { problem = `its parent chain loops back to "${parent.id}"`; break; }
      chain.push(parent.id);
      cursor = parent;
    }
    const out = problem
      ? { ...company, parentId: null, rootId: company.id, depth: 0, problem }
      : { ...company, rootId: chain[chain.length - 1], depth: chain.length - 1, problem: null };
    settled.set(company.id, out);
    return out;
  };
  return companies.map(settle);
};

/**
 * The companies in tree order — each root, then its children depth-first,
 * siblings by name. Pure.
 * @param {ReadonlyArray<object>} settled - settleTree output
 */
export const treeOrder = (settled) => {
  const children = new Map();
  for (const c of settled) {
    const key = c.problem ? null : c.parentId;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(c);
  }
  const byName = (a, b) => String(a.name).localeCompare(String(b.name)) || a.id.localeCompare(b.id);
  const out = [];
  const walk = (parentId) => {
    for (const c of (children.get(parentId) || []).sort(byName)) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(null);
  return out;
};
