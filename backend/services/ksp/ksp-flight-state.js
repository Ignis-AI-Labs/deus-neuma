const PROTOCOL = 'cael-v1';
const BLACK_BOX_MS = 30_000;
const MAX_REASON_CHARS = 500;
const COMMANDS = new Set([
  'set_throttle', 'maintain_attitude', 'release_attitude', 'set_axes', 'stage',
  'set_gear', 'toggle_gear', 'set_brakes', 'set_sas', 'set_rcs', 'deploy_parachutes',
]);
const EXPECTED_FIELDS = new Set([
  'throttle', 'pitchDeg', 'headingDeg', 'rollDeg', 'altitudeM', 'speedMps',
  'verticalSpeedMps', 'apoapsisM', 'periapsisM', 'currentStage', 'gear',
  'brakes', 'sas', 'rcs', 'parachutes',
]);
const TOLERANCE = Object.freeze({
  throttle: 0.02,
  pitchDeg: 3,
  headingDeg: 3,
  rollDeg: 3,
  altitudeM: 50,
  speedMps: 3,
  verticalSpeedMps: 3,
  apoapsisM: 100,
  periapsisM: 100,
  currentStage: 0,
  gear: 0,
  brakes: 0,
  sas: 0,
  rcs: 0,
  parachutes: 0,
});

const finite = (value) => (Number.isFinite(value) ? value : null);
const bounded = (value, min, max, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return number;
};
const bool = (value, label) => {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
};
const compactResource = (resource = {}) => {
  const amount = finite(resource.amount);
  const capacity = finite(resource.capacity);
  return Object.freeze({
    amount,
    capacity,
    fraction: amount !== null && capacity > 0 ? amount / capacity : null,
  });
};
const frozenVector = (value) => Object.freeze((Array.isArray(value) ? value : []).slice(0, 3).map(finite));
const angularDistance = (left, right) => {
  const raw = Math.abs(left - right) % 360;
  return Math.min(raw, 360 - raw);
};
const event = (type, at, detail) => Object.freeze({ type, at, detail });

/** Shape one raw kRPC sample into the stable Cael-v1 sensing packet. Pure. */
export const buildTelemetryPacket = (raw, context = {}) => {
  const sampledAt = raw.sampledAt || new Date().toISOString();
  const vessel = raw.vesselId ? Object.freeze({
    id: String(raw.vesselId),
    name: String(raw.name || 'unnamed vessel'),
    situation: raw.situation || 'Unknown',
    massKg: finite(raw.mass),
    dryMassKg: finite(raw.dryMass),
    thrustN: finite(raw.thrust),
    availableThrustN: finite(raw.availableThrust),
    maxThrustN: finite(raw.maxThrust),
    altitude: Object.freeze({ meanM: finite(raw.meanAltitude), surfaceM: finite(raw.surfaceAltitude) }),
    velocity: Object.freeze({
      surfaceMps: frozenVector(raw.velocity),
      speedMps: finite(raw.speed),
      horizontalMps: finite(raw.horizontalSpeed),
      verticalMps: finite(raw.verticalSpeed),
    }),
    orientation: Object.freeze({
      pitchDeg: finite(raw.pitch), headingDeg: finite(raw.heading), rollDeg: finite(raw.roll),
    }),
    orbit: Object.freeze({
      body: raw.bodyName || null,
      apoapsisM: finite(raw.apoapsisAltitude),
      periapsisM: finite(raw.periapsisAltitude),
      radiusM: finite(raw.orbitRadius),
      eccentricity: finite(raw.eccentricity),
      inclinationDeg: finite(raw.inclinationRadians) === null ? null : raw.inclinationRadians * 180 / Math.PI,
      periodS: finite(raw.orbitPeriod),
      timeToApoapsisS: finite(raw.timeToApoapsis),
      timeToPeriapsisS: finite(raw.timeToPeriapsis),
    }),
    resources: Object.freeze(Object.fromEntries(
      Object.entries(raw.resources || {}).map(([name, value]) => [name, compactResource(value)]),
    )),
    environment: Object.freeze({
      localGravityMps2: finite(raw.localGravity),
      localGravityG: finite(raw.localGravity) === null ? null : raw.localGravity / 9.80665,
      experiencedG: finite(raw.gForce),
      atmosphericDensityKgM3: finite(raw.atmosphereDensity),
      staticPressurePa: finite(raw.staticPressure),
      dynamicPressurePa: finite(raw.dynamicPressure),
      temperatureK: finite(raw.temperature),
      mach: finite(raw.mach),
    }),
    control: Object.freeze({
      throttle: finite(raw.throttle),
      pitch: finite(raw.controlPitch),
      yaw: finite(raw.controlYaw),
      roll: finite(raw.controlRoll),
      currentStage: finite(raw.currentStage),
      gear: Boolean(raw.gear),
      brakes: Boolean(raw.brakes),
      sas: Boolean(raw.sas),
      rcs: Boolean(raw.rcs),
      parachutes: Boolean(raw.parachutes),
      autopilotEngaged: Boolean(raw.autopilotEngaged),
    }),
  }) : null;

  return Object.freeze({
    protocol: PROTOCOL,
    sampledAt,
    sequence: Number(context.sequence || 0),
    game: Object.freeze({
      scene: raw.scene || 'Unknown', paused: Boolean(raw.paused), universalTimeS: finite(raw.universalTime),
      endpoint: context.endpoint || null,
    }),
    vessel,
    events: Object.freeze([...(context.events || [])]),
    commandFeedback: context.lastCommand || null,
    recorder: context.recorder || null,
    lastRun: context.lastRun || null,
  });
};

/** Derive causal flight events by comparing consecutive sensing packets. Pure. */
export const deriveFlightEvents = (previous, current) => {
  const at = current.sampledAt;
  if (!previous?.vessel && current.vessel) return [event('vessel_acquired', at, current.vessel.name)];
  if (previous?.vessel && !current.vessel) return [event('vessel_lost', at, previous.vessel.name)];
  if (!previous?.vessel || !current.vessel) return [];
  const out = [];
  if (previous.vessel.id !== current.vessel.id) {
    out.push(event('vessel_changed', at, `${previous.vessel.name} → ${current.vessel.name}`));
  }
  if (previous.vessel.situation !== current.vessel.situation) {
    out.push(event('situation_changed', at, `${previous.vessel.situation} → ${current.vessel.situation}`));
  }
  const beforeControl = previous.vessel.control;
  const afterControl = current.vessel.control;
  if (beforeControl.currentStage !== afterControl.currentStage) {
    out.push(event('stage_changed', at, `${beforeControl.currentStage} → ${afterControl.currentStage}`));
  }
  if (previous.vessel.availableThrustN > 0 && current.vessel.availableThrustN <= 0 && afterControl.throttle > 0.05) {
    out.push(event('engine_flameout', at, 'available thrust fell to zero under throttle'));
  }
  if (previous.vessel.environment.staticPressurePa > 1 && current.vessel.environment.staticPressurePa <= 1) {
    out.push(event('vacuum_entered', at, 'static pressure crossed below 1 Pa'));
  }
  if (previous.vessel.environment.experiencedG < 5 && current.vessel.environment.experiencedG >= 5) {
    out.push(event('high_g', at, `${current.vessel.environment.experiencedG.toFixed(2)} g`));
  }
  if (previous.vessel.situation !== 'Orbiting' && current.vessel.situation === 'Orbiting') {
    out.push(event('orbit_achieved', at, current.vessel.orbit.body || 'unknown body'));
  }
  for (const [name, resource] of Object.entries(current.vessel.resources)) {
    const before = previous.vessel.resources[name];
    if (before?.amount > 0 && resource.amount === 0) out.push(event('resource_depleted', at, name));
  }
  return out;
};

const normalizedExpected = (raw) => {
  if (raw === undefined) return Object.freeze({});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('expected must be an object');
  const entries = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!EXPECTED_FIELDS.has(key)) throw new Error(`unsupported expected field ${key}`);
    if (['gear', 'brakes', 'sas', 'rcs', 'parachutes'].includes(key)) entries.push([key, bool(value, `expected.${key}`)]);
    else if (!Number.isFinite(Number(value))) throw new Error(`expected.${key} must be finite`);
    else entries.push([key, Number(value)]);
  }
  return Object.freeze(Object.fromEntries(entries));
};

const commandDelay = (command, raw) => {
  const fallback = command === 'maintain_attitude' ? 1000 : command === 'set_axes' ? Number(raw.durationMs ?? 250) + 250 : 250;
  return bounded(raw.observeAfterMs ?? fallback, 0, 5000, 'observeAfterMs');
};

/** Validate and normalize one model-issued command at the process boundary. Pure. */
export const validateKspCommand = (raw = {}) => {
  if (!COMMANDS.has(raw.command)) throw new Error(`unsupported KSP command ${String(raw.command || '')}`);
  const reason = String(raw.reason || '').trim();
  if (!reason || reason.length > MAX_REASON_CHARS) throw new Error(`reason must be 1-${MAX_REASON_CHARS} characters`);
  const out = { command: raw.command, reason, expected: normalizedExpected(raw.expected) };
  if (raw.command === 'set_throttle') out.value = bounded(raw.value, 0, 1, 'value');
  if (raw.command === 'maintain_attitude') {
    out.pitchDeg = bounded(raw.pitchDeg, -90, 90, 'pitchDeg');
    out.headingDeg = bounded(raw.headingDeg, 0, 360, 'headingDeg');
    out.rollDeg = bounded(raw.rollDeg ?? 0, -180, 180, 'rollDeg');
  }
  if (raw.command === 'set_axes') {
    const axes = ['pitch', 'yaw', 'roll'].filter((name) => raw[name] !== undefined);
    if (axes.length === 0) throw new Error('set_axes requires pitch, yaw, or roll');
    for (const name of axes) out[name] = bounded(raw[name], -1, 1, name);
    out.durationMs = bounded(raw.durationMs ?? 250, 50, 2000, 'durationMs');
  }
  if (['set_gear', 'set_brakes', 'set_sas', 'set_rcs'].includes(raw.command)) {
    out.enabled = bool(raw.enabled, 'enabled');
  }
  out.observeAfterMs = commandDelay(raw.command, raw);
  return Object.freeze(out);
};

const actualFor = (packet, field) => {
  const vessel = packet?.vessel;
  if (!vessel) return null;
  const values = {
    throttle: vessel.control.throttle,
    pitchDeg: vessel.orientation.pitchDeg,
    headingDeg: vessel.orientation.headingDeg,
    rollDeg: vessel.orientation.rollDeg,
    altitudeM: vessel.altitude.meanM,
    speedMps: vessel.velocity.speedMps,
    verticalSpeedMps: vessel.velocity.verticalMps,
    apoapsisM: vessel.orbit.apoapsisM,
    periapsisM: vessel.orbit.periapsisM,
    currentStage: vessel.control.currentStage,
    gear: vessel.control.gear,
    brakes: vessel.control.brakes,
    sas: vessel.control.sas,
    rcs: vessel.control.rcs,
    parachutes: vessel.control.parachutes,
  };
  return values[field] ?? null;
};

/** Add deterministic setpoint expectations to any explicit model forecast. Pure. */
export const expectedForCommand = (command, before) => Object.freeze({
  ...(command.command === 'set_throttle' ? { throttle: command.value } : {}),
  ...(command.command === 'maintain_attitude' ? {
    pitchDeg: command.pitchDeg, headingDeg: command.headingDeg, rollDeg: command.rollDeg,
  } : {}),
  ...(command.command === 'stage' && before?.vessel ? {
    currentStage: Math.max(0, before.vessel.control.currentStage - 1),
  } : {}),
  ...(['set_gear', 'set_brakes', 'set_sas', 'set_rcs'].includes(command.command)
    ? { [command.command.replace(/^set_/, '')]: command.enabled } : {}),
  ...(command.command === 'deploy_parachutes' ? { parachutes: true } : {}),
  ...command.expected,
});

/** Compare a command's forecast/setpoint with the observed packet. Pure. */
export const measureCommandDelta = (expected, packet) => {
  const fields = Object.entries(expected).map(([field, wanted]) => {
    const actual = actualFor(packet, field);
    const numeric = typeof wanted === 'number' && typeof actual === 'number';
    const delta = numeric
      ? (['headingDeg', 'rollDeg'].includes(field) ? angularDistance(actual, wanted) : actual - wanted)
      : (actual === wanted ? 0 : 1);
    const tolerance = TOLERANCE[field] ?? 0;
    return Object.freeze({ field, expected: wanted, actual, delta, tolerance, withinTolerance: actual !== null && Math.abs(delta) <= tolerance });
  });
  const available = fields.filter((entry) => entry.actual !== null);
  return Object.freeze({
    status: fields.length === 0 ? 'not_requested' : available.length === 0 ? 'unavailable'
      : available.every((entry) => entry.withinTolerance) ? 'within_tolerance' : 'diverged',
    fields: Object.freeze(fields),
  });
};

/** Keep only the state needed to read a command receipt and black box. Pure. */
export const compactTelemetry = (packet) => Object.freeze({
  sampledAt: packet.sampledAt,
  game: packet.game,
  vessel: packet.vessel,
});

const initialMetrics = (packet) => Object.freeze({
  maxAltitudeM: packet.vessel?.altitude.meanM || 0,
  maxApoapsisM: packet.vessel?.orbit.apoapsisM || 0,
  maxSpeedMps: packet.vessel?.velocity.speedMps || 0,
  maxExperiencedG: packet.vessel?.environment.experiencedG || 0,
  orbitAchieved: packet.vessel?.situation === 'Orbiting',
  finalSituation: packet.vessel?.situation || null,
  commandCount: 0,
});
const nextMetrics = (metrics, packet) => Object.freeze({
  maxAltitudeM: Math.max(metrics.maxAltitudeM, packet.vessel?.altitude.meanM || 0),
  maxApoapsisM: Math.max(metrics.maxApoapsisM, packet.vessel?.orbit.apoapsisM || 0),
  maxSpeedMps: Math.max(metrics.maxSpeedMps, packet.vessel?.velocity.speedMps || 0),
  maxExperiencedG: Math.max(metrics.maxExperiencedG, packet.vessel?.environment.experiencedG || 0),
  orbitAchieved: metrics.orbitAchieved || packet.vessel?.situation === 'Orbiting',
  finalSituation: packet.vessel?.situation || metrics.finalSituation,
  commandCount: metrics.commandCount,
});

/** Open an immutable in-memory run record for one vessel. Pure. */
export const startFlightRecord = (packet, owner) => Object.freeze({
  owner: Object.freeze({ ...owner }),
  runAt: packet.sampledAt,
  startedUniversalTimeS: packet.game.universalTimeS,
  vesselId: packet.vessel.id,
  vesselName: packet.vessel.name,
  body: packet.vessel.orbit.body,
  frames: Object.freeze([compactTelemetry(packet)]),
  events: Object.freeze([...packet.events]),
  commands: Object.freeze([]),
  metrics: initialMetrics(packet),
});

/** Advance the rolling 30-second record and lifetime metrics. Pure. */
export const advanceFlightRecord = (record, packet, newEvents = []) => {
  const cutoff = Date.parse(packet.sampledAt) - BLACK_BOX_MS;
  return Object.freeze({
    ...record,
    frames: Object.freeze([...record.frames, compactTelemetry(packet)].filter((frame) => Date.parse(frame.sampledAt) >= cutoff)),
    events: Object.freeze([...record.events, ...newEvents].filter((entry) => Date.parse(entry.at) >= cutoff)),
    commands: Object.freeze(record.commands.filter((entry) => Date.parse(entry.issuedAt) >= cutoff)),
    metrics: nextMetrics(record.metrics, packet),
  });
};

/** Add one causal command receipt to the rolling record. Pure. */
export const appendFlightCommand = (record, receipt) => Object.freeze({
  ...record,
  commands: Object.freeze([...record.commands, receipt]),
  metrics: Object.freeze({ ...record.metrics, commandCount: record.metrics.commandCount + 1 }),
});

const survived = (situation) => ['Landed', 'Splashed', 'Docked', 'Orbiting'].includes(situation);

/** Close a run into the encrypted-workspace benchmark record shape. Pure. */
export const finalizeFlightRecord = (record, reason, endedAt, endedUniversalTimeS = null) => {
  const durationS = Number.isFinite(endedUniversalTimeS) && Number.isFinite(record.startedUniversalTimeS)
    ? Math.max(0, endedUniversalTimeS - record.startedUniversalTimeS)
    : Math.max(0, (Date.parse(endedAt) - Date.parse(record.runAt)) / 1000);
  const outcome = survived(record.metrics.finalSituation) ? 'survived' : reason;
  const dimensions = Object.freeze([
    Object.freeze({ key: 'orbit_achieved', label: 'Orbit achieved', score: record.metrics.orbitAchieved ? 1 : 0, n: 1 }),
    Object.freeze({ key: 'survived', label: 'Vessel survived', score: outcome === 'survived' ? 1 : 0, n: 1 }),
    Object.freeze({ key: 'peak_altitude_m', label: 'Peak altitude (m)', score: record.metrics.maxAltitudeM, n: 1 }),
    Object.freeze({ key: 'peak_speed_mps', label: 'Peak speed (m/s)', score: record.metrics.maxSpeedMps, n: 1 }),
    Object.freeze({ key: 'peak_g', label: 'Peak experienced G', score: record.metrics.maxExperiencedG, n: 1 }),
  ]);
  return Object.freeze({
    kind: 'ksp-sovereignty-lab', protocol: PROTOCOL, runAt: record.runAt,
    participant: record.owner, substrate: 'KSP 1 + kRPC 0.6',
    game: Object.freeze({ vessel: record.vesselName, body: record.body, outcome, reason, endedAt, durationS }),
    dimensions,
    metrics: record.metrics,
    blackBox: Object.freeze({ windowSeconds: 30, frames: record.frames, events: record.events, commands: record.commands }),
  });
};

/** Strip a full private run to the portable comparison card. Pure. */
export const portableKspSummary = (run, id = null) => Object.freeze({
  id, kind: run.kind, protocol: run.protocol, runAt: run.runAt,
  participant: run.participant, substrate: run.substrate, game: run.game,
  dimensions: run.dimensions, metrics: run.metrics,
});
