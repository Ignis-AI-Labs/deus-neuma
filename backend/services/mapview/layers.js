/**
 * mapview/layers — the architecture law, inferred then signed.
 *
 * A layer rule invented by a tool is a rule nobody agreed to, and it fires on
 * legitimate code until it is switched off. So mapview never invents one. It
 * READS the boundary the codebase already keeps — for a pair of layers where
 * many edges run A→B and *not one* runs B→A, that asymmetry is a boundary the
 * authors have been honouring, whether or not anyone wrote it down — and offers
 * it as a proposal. Only after the operator signs it into `mapview.config.json`
 * does a crossing become a finding.
 *
 * This is the difference between […] and […]
 *
 * All pure.
 */

/**
 * Enough forward traffic that a clean reverse count means a real boundary rather
 * than two modules that simply never met. Below this the asymmetry is noise.
 */
const MIN_EVIDENCE_EDGES = 8;

/** The layer a file belongs to: its top-level directory. Pure. */
export const layerOf = (file, layerNames) => {
  const top = file.split('/')[0];
  return layerNames.includes(top) ? top : null;
};

/**
 * Count module edges between top-level directories, both directions. Pure.
 * @returns {Map<string, Map<string, number>>} from → to → count
 */
const edgeMatrix = (modules, layerNames) => {
  const matrix = new Map();
  for (const e of modules) {
    const from = layerOf(e.from, layerNames);
    const to = layerOf(e.to, layerNames);
    if (!from || !to || from === to) continue;
    if (!matrix.has(from)) matrix.set(from, new Map());
    matrix.get(from).set(to, (matrix.get(from).get(to) || 0) + 1);
  }
  return matrix;
};

/**
 * Propose the layer law this codebase is already keeping.
 *
 * For every ordered pair, if A→B carries real traffic and B→A carries none, the
 * absence is treated as intent and proposed as `B must not import A`. Each
 * proposal ships with the evidence that produced it so the operator is signing a
 * measured fact, not a guess.
 *
 * @param {{from:string,to:string}[]} modules
 * @param {string[]} allFiles
 * @returns {{ layers: string[], forbidden: {from,to,reason}[] }}
 * Pure.
 */
export const inferLayerLaw = (modules, allFiles) => {
  const layerNames = [...new Set(allFiles.map((f) => f.split('/')[0]).filter((t) => !t.includes('.')))].sort();
  const matrix = edgeMatrix(modules, layerNames);
  const countOf = (a, b) => matrix.get(a)?.get(b) || 0;

  const forbidden = [];
  for (const a of layerNames) {
    for (const b of layerNames) {
      if (a === b) continue;
      const forward = countOf(a, b);
      const reverse = countOf(b, a);
      if (forward < MIN_EVIDENCE_EDGES || reverse !== 0) continue;
      forbidden.push({
        from: b,
        to: a,
        reason: `${a}/ imports ${b}/ ${forward} times; ${b}/ imports ${a}/ zero times. The one-way boundary is already being kept.`,
      });
    }
  }
  return {
    layers: layerNames,
    forbidden: forbidden.sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to)),
  };
};

/**
 * Module edges that break a SIGNED rule. Returns [] when no law is signed —
 * silence until the operator has agreed to something is the whole point.
 *
 * @param {{from:string,to:string}[]} modules
 * @param {{ forbidden?: {from:string,to:string}[] }|null} law
 * Pure.
 */
export const findLayerViolations = (modules, law) => {
  const rules = law?.forbidden;
  if (!Array.isArray(rules) || !rules.length) return [];
  const layerNames = [...new Set(rules.flatMap((r) => [r.from, r.to]))];
  const violations = [];
  for (const rule of rules) {
    for (const e of modules) {
      if (layerOf(e.from, layerNames) === rule.from && layerOf(e.to, layerNames) === rule.to) {
        violations.push({ rule, from: e.from, to: e.to });
      }
    }
  }
  return violations.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
};
