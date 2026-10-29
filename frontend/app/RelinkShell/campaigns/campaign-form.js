// campaign-form.js — the campaign editor's draft ⇄ the campaign record (shape
// v2, campaign plan §3.1). Pure: a record in, the form's strings out; the
// form's strings in, the body the campaign routes take out. The backend's
// shape law (campaign-shape.js) judges the body whole and answers in words.

const SEP = /\s+\|\s+/;

/** The angles as the form writes them: one per line, `name | thesis | audience`. Pure. */
export const anglesToText = (angles) => (angles || [])
  .map((a) => [a.name, a.thesis, a.audience].filter((v, i) => i === 0 || v).join(' | '))
  .join('\n');

/**
 * The form's angle lines as angles; an angle keeps its id when its name
 * stands unchanged. Pure.
 * @param {string} raw
 * @param {Array<object>} [previous]
 */
export const textToAngles = (raw, previous = []) => String(raw || '').split('\n')
  .map((line) => line.trim()).filter(Boolean)
  .map((line) => {
    const [name, thesis = '', audience = ''] = line.split(SEP).map((p) => p.trim());
    const kept = previous.find((a) => a.name === name);
    return { ...(kept ? { id: kept.id } : {}), name, thesis, audience };
  });

const num = (v) => (String(v ?? '').trim() === '' ? null : Number(v));

/** The editor's draft for a campaign — or a fresh one for a company. Pure. */
export const draftOf = (campaign, { companyId = '' } = {}) => ({
  name: campaign?.name || '',
  companyId: campaign?.companyId || companyId || '',
  status: campaign?.status || 'draft',
  goalKind: campaign?.goal?.kind || '',
  goalLabel: campaign?.goal?.label || '',
  kpiMetric: campaign?.kpi?.metric || '',
  kpiTarget: campaign?.kpi?.target != null ? String(campaign.kpi.target) : '',
  kpiBy: campaign?.kpi?.by || '',
  start: campaign?.window?.start || '',
  end: campaign?.window?.end || '',
  hours: campaign?.budget?.hours != null ? String(campaign.budget.hours) : '',
  money: campaign?.budget?.money != null ? String(campaign.budget.money) : '',
  budgetNote: campaign?.budget?.note || '',
  angles: anglesToText(campaign?.angles),
  subs: Object.fromEntries((campaign?.subs || []).map((s) => [s.accountId, { cadence: s.cadence || '', role: s.role || '', angleIds: s.angleIds || [] }])),
  cadence: campaign?.cadence || '',
  marketingPlan: campaign?.marketingPlan || '',
  funnelPlan: campaign?.funnelPlan || '',
  notes: campaign?.notes || '',
});

/**
 * The body the campaign routes take, from the editor's draft. A part left
 * blank is sent as null, so clearing a field clears it. Pure.
 * @param {ReturnType<typeof draftOf>} draft
 * @param {object} [campaign] - the record being edited (angle ids)
 */
export const bodyOf = (draft, campaign = null) => {
  const angles = textToAngles(draft.angles, campaign?.angles || []);
  const known = new Set(angles.map((a) => a.id).filter(Boolean));
  return {
    name: draft.name.trim(),
    companyId: draft.companyId || null,
    status: draft.status,
    goal: draft.goalKind ? { kind: draft.goalKind, label: draft.goalLabel.trim() } : null,
    kpi: draft.kpiMetric ? { metric: draft.kpiMetric, target: num(draft.kpiTarget), by: draft.kpiBy || null } : null,
    window: draft.start || draft.end ? { start: draft.start, end: draft.end } : null,
    budget: draft.hours || draft.money || draft.budgetNote.trim()
      ? { hours: num(draft.hours), money: num(draft.money), note: draft.budgetNote.trim() }
      : null,
    angles,
    subs: Object.entries(draft.subs).map(([accountId, s]) => ({
      accountId, role: s.role, cadence: s.cadence,
      // An angle the edit removed falls away from the sub; a renamed one keeps no id yet.
      angleIds: (s.angleIds || []).filter((id) => known.has(id)),
    })),
    cadence: draft.cadence.trim(),
    marketingPlan: draft.marketingPlan,
    funnelPlan: draft.funnelPlan,
    notes: draft.notes,
  };
};

/** Does this campaign run on a platform (a sub on one of its accounts)? Pure. */
export const runsOn = (campaign, channelId) => (campaign?.subs || [])
  .some((s) => String(s.accountId || '').replace(/-\d+$/, '') === channelId);
