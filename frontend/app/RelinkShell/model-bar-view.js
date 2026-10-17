// model-bar-view.js — pure shaping for the composer's model bar.
//
// Kept free of React so the decisions the bar makes (which options to show, what
// the trigger reads, whether a control may render at all) are provable with real
// inputs and no DOM.

/** A weights size the picker can read at a glance — models run tens of GB. */
const sizeLabel = (bytes) =>
  (Number.isFinite(bytes) && bytes > 0 ? ` · ${(bytes / 2 ** 30).toFixed(1)}G` : '');

/**
 * Which option the dropdown is SITTING on.
 *
 * Two namespaces meet here and must not be confused. On the rig's own weights
 * the picker chooses among CATALOG ids (root-relative paths) while the route
 * names the SERVED model id — so the loaded catalog entry is what the being
 * rides, and using the served name would leave the trigger matching no option at
 * all (and mark the wrong row LOADED). Off the rig, the route's model IS the
 * option id. A rig serving weights from outside the catalog has no loaded id, and
 * then the served name stands as the honest current value.
 * @param {{switchBy?: string, loadedId?: string|null, route?: {model?: string}}|null} view
 * @returns {string}
 */
export const currentModelId = (view) => (view?.switchBy === 'ignite'
  ? view?.loadedId || view?.route?.model || ''
  : view?.route?.model || '');

/**
 * The MODEL dropdown's options for one being.
 *
 * The being's CURRENT model is always present even when the provider never
 * published it (a hand-set override, a model pulled from an account since) —
 * an absent current option would make the trigger read empty and imply the
 * being rides nothing. On the rig's own weights the loaded entry is marked, so
 * "what is loaded" and […] stay visibly separate facts.
 *
 * @param {{models?: Array<{id: string, name?: string, sizeBytes?: number}>, loadedId?: string|null, switchBy?: string, route?: {model?: string}}} view
 *        the backend's model view (services/inference.js getBeingModels)
 * @returns {Array<{value: string, label: string}>} global Select options
 */
export const modelBarOptions = (view) => {
  const current = currentModelId(view);
  const entries = Array.isArray(view?.models) ? view.models.filter((m) => m?.id) : [];
  const known = new Set(entries.map((m) => m.id));
  const unavailable = view?.catalogSource === 'live' && current && !known.has(current);
  const all = known.has(current) || !current
    ? entries
    : [{ id: current, name: current }, ...entries];
  return all.map((m) => ({
    value: m.id,
    label: `${m.name && m.name !== m.id ? m.name : m.id}${sizeLabel(m.sizeBytes)}${m.id === view?.loadedId ? ' · LOADED' : ''}${unavailable && m.id === current ? ' · UNAVAILABLE' : ''}`,
    ...(unavailable && m.id === current ? { disabled: true } : {}),
  }));
};

/**
 * What the MODEL trigger says when the list has not arrived (or is empty). The
 * being's own model is the honest placeholder; only a being with no resolvable
 * route falls back to a word.
 * @param {{route?: {model?: string}}|null} view
 * @returns {string}
 */
export const modelPlaceholder = (view) => view?.route?.model || 'no model';

/**
 * Shape the substrate catalog view into the bar's model view — same switchBy
 * and loadedId the being endpoint already returns for an ignite route.
 * Pure.
 * @param {{active?: string|null, models?: Array, withheld?: number, provider?: string, loadedId?: string|null, route?: object}|null} view
 * @returns {object|null}
 */
export const asIgniteModels = (view) => (view ? Object.freeze({
  switchBy: 'ignite',
  loadedId: view.active ?? view.loadedId ?? null,
  models: view.models ?? [],
  withheld: view.withheld ?? 0,
  route: view.route ?? { model: view.active || view.served || '', provider: view.provider || 'llama-server', kind: 'local' },
}) : null);

/**
 * A being on the rig rides the LIVE substrate catalog — never a stale
 * snapshot that still marks the previous weights LOADED.
 * Pure.
 */
export const mergeIgniteView = (being, substrate) => {
  const ignite = asIgniteModels(substrate);
  if (!ignite) return being || null;
  return Object.freeze({
    ...ignite,
    route: being?.route || ignite.route,
  });
};

/**
 * The EFFORT dropdown's options — exactly the rungs this route offers, weakest
 * first, each under the VENDOR'S own word for it (ChatGPT's EXTRA HIGH, Z.AI's
 * MAX) and the house word only where no vendor word exists. An empty ladder
 * yields nothing: the control stands down rather than offering a rung the vendor
 * does not have.
 *
 * The gears above HIGH are RUNGS here, never chips (Design note, 2026-07-30 — they are
 * quantities of the same thing. Whether the model reasons AT ALL is the separate
 * switch beside this list, because that is a different question.
 * @param {{tiers?: Array<string>, labels?: Object}|null} capability
 * @returns {Array<{value: string, label: string}>}
 */
export const effortOptions = (capability) =>
  (Array.isArray(capability?.tiers) ? capability.tiers : [])
    .map((rung) => ({ value: rung, label: capability?.labels?.[rung] || rung.toUpperCase() }));

/**
 * Why the effort control is standing down, in the operator's terms — so an
 * absent ladder reads as a fact about the model rather than a broken control.
 * @param {{channel?: string}|null} capability
 * @param {{kind?: string}|null} route
 * @returns {string}
 */
export const effortAbsenceNote = (capability, route) => {
  // Read from the LADDER, not the channel: a lane could carry a proven
  // thinking switch and no rungs at all, and the dropdown still has nothing to say.
  if ((capability?.tiers?.length ?? 0) > 0) return '';
  return route?.kind === 'local'
    ? 'This substrate does not think before it speaks — there are no effort tiers to set.'
    : 'This model publishes no effort tiers.';
};

/**
 * The whole bar's state in one shape, in the order the operator reads it —
 * MODEL, EFFORT, THINKING. The effort dropdown holds every rung the chosen model
 * actually has (Design note, 2026-07-30: […]), and
 * the switch stands beside it ONLY where turning reasoning off was PROVEN on
 * that wire — never as a guess ([…]).
 *
 * A bar with no being shows nothing. An unresolved named being keeps its bar
 * so the read status can explain failure and offer recovery.
 * @param {{beingId?: string|null, models?: object|null, effort?: object|null, surface?: 'stream'|'substrate'}} input
 * @returns {{show: boolean, withheld: number, model: {options: Array, value: string, placeholder: string, switchBy: string}, effort: {options: Array, value: string, note: string}, thinking: {show: boolean, on: boolean, label: string}}}
 */
export const modelBarState = ({ beingId = null, models = null, effort = null, surface = 'stream' } = {}) => {
  const route = effort?.route || models?.route || null;
  return Object.freeze({
    show: surface === 'substrate' || Boolean(beingId),
    withheld: Number.isFinite(models?.withheld) ? models.withheld : 0,
    model: Object.freeze({
      // The withheld count rides INSIDE the dropdown as a disabled tail row
      // (Design note, 2026-08-28: […]), pointing at the folder law.
      options: Object.freeze([
        ...modelBarOptions(models),
        ...(Number.isFinite(models?.withheld) && models.withheld > 0
          ? [Object.freeze({
            value: '__not-authorized',
            label: `${models.withheld} NOT AUTHORIZED — FOLDERS DECIDE (SETTINGS › MODELS)`,
            disabled: true,
          })]
          : []),
      ]),
      value: currentModelId(models) || route?.model || '',
      placeholder: modelPlaceholder(models || effort),
      switchBy: models?.switchBy || (surface === 'substrate' ? 'ignite' : 'route'),
    }),
    effort: Object.freeze({
      options: beingId ? effortOptions(effort?.capability) : [],
      value: effort?.choice?.effort || '',
      note: effortAbsenceNote(effort?.capability, route),
    }),
    // The switch renders only where a route can actually be told not to reason.
    // Everywhere else the being reasons by construction, and a dead switch would
    // read as a choice the operator does not have.
    thinking: Object.freeze({
      show: effort?.capability?.thinking === true,
      on: effort?.choice?.thinking !== false,
      // The vendor's own word where the vendor has one — Z.AI calls it DEEP
      // THINK, Anthropic EXTENDED THINKING. Falls back to the house word rather
      // than inventing a vendor-sounding one.
      label: effort?.capability?.thinkingLabel || 'THINKING',
    }),
  });
};
