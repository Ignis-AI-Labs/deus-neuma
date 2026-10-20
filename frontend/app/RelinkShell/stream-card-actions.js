// Pure inbound operator-card translation. Effects belong to the stream host.
const actions = Object.freeze({
  'tool:approval_request': (data, lane) => ({ type: 'APPROVAL_REQUEST', id: data.id, tool: data.tool, args: data.args, fullArgs: data.fullArgs || '', scope: data.scope, media: data.media || [], lane }),
  'tool:approval_resolved': (data) => ({ type: 'APPROVAL_RESOLVED', id: data.id, decision: data.decision }),
  'operator:ask': (data) => ({ type: 'ASK_REQUEST', id: data.id, questions: data.questions, question: data.question, options: data.options }),
  'operator:ask_resolved': (data) => ({ type: 'ASK_RESOLVED', id: data.id, status: data.status, answer: data.answer }),
  'seal:self_offer': (data) => ({ type: 'SEAL_REQUEST', id: data.id, neumaId: data.neumaId, beingName: data.beingName }),
  'seal:self_resolved': (data) => ({ type: 'SEAL_RESOLVED', id: data.id, status: data.status, txHash: data.txHash, network: data.network, networkLabel: data.networkLabel, blockNumber: data.blockNumber }),
  'operator:plan': (data) => ({ type: 'PLAN_REQUEST', id: data.id, name: data.name, goal: data.goal, steps: data.steps, workspace: data.workspace || null, clock: typeof data.clock === 'string' ? data.clock : '', concurrency: Number.isInteger(data.concurrency) ? data.concurrency : null, checkIn: Number.isFinite(data.checkIn) ? data.checkIn : null, planKind: data.kind === 'chat' ? 'chat' : 'team', detail: typeof data.detail === 'string' ? data.detail : '' }),
  'operator:plan_resolved': (data) => ({ type: 'PLAN_RESOLVED', id: data.id, status: data.status, notes: data.notes }),
  'operator:team_start': (data) => ({ type: 'TEAMRUN_START', id: data.id, name: data.name, goal: data.goal, board: data.board, background: data.background === true }),
  'operator:team_board': (data) => ({ type: 'TEAMRUN_BOARD', id: data.id, board: data.board }),
  'operator:team_done': (data) => ({ type: 'TEAMRUN_DONE', id: data.id, status: data.status, order: data.order, failures: data.failures || null, skipped: data.skipped || null, stopped: data.stopped === true, delivery: data.delivery || null, record: data.record || null }),
  'operator:team_torch': (data) => ({ type: 'TEAMRUN_TORCH', id: data.id, stepId: data.stepId, member: data.member, torch: data.torch }),
});
const confirmations = new Set(['tool:approval_request', 'operator:ask', 'seal:self_offer', 'operator:plan', 'operator:team_start']);

/** Translate a supported card frame without dispatching, playing audio or reading state. */
export const streamCardAction = (channel, data, lane = null) => {
  // Council owns its own approval card; duplicating it creates two decisions.
  if (channel === 'tool:approval_request' && data.surface === 'council') return null;
  // A team run's frames reach every desk of the operator (the WORKFLOW window
  // follows them all); its chip belongs only in a chat with the lead.
  if (channel === 'operator:team_start' && data.laneId && lane && data.laneId !== lane) return null;
  if (!Object.hasOwn(actions, channel)) return null;
  return { action: actions[channel](data, lane), sound: confirmations.has(channel) ? 'confirm' : null };
};
