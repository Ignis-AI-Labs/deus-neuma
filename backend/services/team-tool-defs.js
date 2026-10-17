// Team tool DEFINITIONS — the 'team' server tool cards. plan_submit stays a
// tool (it IS the submission mechanism); team_run and workspace_run became
// the team/run + team/workspace-run INTENTS (Stage 3 — intents/team-run.js),
// filed and settled by the sweep.

// A run's or a step's CLOCK (team-clock.js, #577) — optional; none = the part
// works until it is done or someone stops it.
const CLOCK_SCHEMA = Object.freeze({
  type: 'object',
  description: 'How long (optional): work = minutes of WORKING time (never time waiting its turn), or dueDate/dueTime; then = what happens when it passes. {none: true} on a step = no clock for it',
  properties: Object.freeze({
    work: Object.freeze({ type: 'number' }),
    dueDate: Object.freeze({ type: 'string', description: 'YYYY-MM-DD' }),
    dueTime: Object.freeze({ type: 'string', description: 'HH:MM, local' }),
    then: Object.freeze({ type: 'string', enum: Object.freeze(['notify', 'wrap-up', 'stop']) }),
    none: Object.freeze({ type: 'boolean' }),
  }),
});

// Advertised whenever a bound being speaks — planning a team needs a house
// to draw it from, and the house is the operator's.
export const PLAN_SUBMIT_TOOL = Object.freeze({
  name: 'plan_submit',
  server: 'team',
  description: 'Submit a team plan to your operator for approval and WAIT for their verdict — args {goal, steps, name?, workspace?, clock?, concurrency?, checkIn?}. goal: the one sentence every step serves. steps: [{id, member, task, role?, needs?, done?, files?, clock?}] — member is the NAME of the teammate who owns the step, needs lists ids of steps this one builds on, done says when the part counts as complete, files lists its deliverables (paths relative to the workspace) — the platform checks each exists, non-empty, before the step counts as done. Every member works its step with its own file tools, writing only inside the workspace. Write each task as concrete actions — what to read, what to produce, which file to write — not an open question: a concrete step is worked in a fraction of the thinking. YOU MAY NAME YOURSELF ON SEVERAL STEPS AT ONCE: independent steps run in parallel, so putting your own name on three of them splits you into three facets working simultaneously, each carrying your identity, then reading each other\'s results back through a step that needs them. Use it when the work has genuinely separable parts and you would otherwise do them one after another. You are not creating new beings and nothing is discarded when the run ends — it is you, working in more than one place. Parallel width is capped at what this rig was measured to sustain. workspace (optional): {root, budgetBytes?} — the ONE directory all the team\'s file work is confined to, with a shared space budget (default 512MB); once approved, nothing writes outside it. Name none and the run gets a fresh arena of its own. clock (optional; a step may carry its own): {work: minutes of WORKING time, dueDate?, dueTime?, then?: notify|wrap-up|stop} — set none and every part works until done or stopped. concurrency (optional): how many parts work at once — deep parts go faster fewer at a time. Approved plans become the plan of record; a revise verdict returns your operator\'s notes so you can correct and resubmit.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      name: Object.freeze({ type: 'string', description: 'A short team designation (optional)' }),
      goal: Object.freeze({ type: 'string', description: 'The shared goal every step serves' }),
      steps: Object.freeze({
        type: 'array',
        description: 'The plan steps: [{id, member, task, role?, needs?, done?, files?, clock?}]',
        items: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            id: Object.freeze({ type: 'string' }),
            member: Object.freeze({ type: 'string', description: 'Name of the teammate who owns this step' }),
            task: Object.freeze({ type: 'string' }),
            role: Object.freeze({ type: 'string' }),
            needs: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) }),
            done: Object.freeze({ type: 'string' }),
            files: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }), description: 'Deliverables, relative to the workspace — checked on disk' }),
            clock: CLOCK_SCHEMA,
          }),
          required: Object.freeze(['id', 'member', 'task']),
        }),
      }),
      workspace: Object.freeze({
        type: 'object',
        description: 'The assigned workspace: the one directory all the team\'s file work is confined to',
        properties: Object.freeze({
          root: Object.freeze({ type: 'string', description: 'Directory path — the team\'s whole arena' }),
          budgetBytes: Object.freeze({ type: 'number', description: 'Shared space budget in bytes (default 512MB)' }),
        }),
        required: Object.freeze(['root']),
      }),
      clock: CLOCK_SCHEMA,
      concurrency: Object.freeze({ type: 'integer', description: 'How many parts work at once (default: as many as the rig allows)' }),
      checkIn: Object.freeze({ type: 'number', description: 'Minutes between check-ins to your operator and the house\'s Optio while the run works (default 60; 0 = none)' }),
    }),
    required: Object.freeze(['goal', 'steps']),
  }),
});
