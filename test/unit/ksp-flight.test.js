import { describe, expect, it } from 'vitest';
import {
  advanceFlightRecord,
  appendFlightCommand,
  buildTelemetryPacket,
  deriveFlightEvents,
  expectedForCommand,
  finalizeFlightRecord,
  measureCommandDelta,
  portableKspSummary,
  startFlightRecord,
  validateKspCommand,
} from '../../backend/services/ksp/ksp-flight-state.js';
import { isKspTool, kspToolsFor } from '../../backend/services/ksp/ksp-being-tools.js';
import { applyToolMode, checkToolAccess, GLOBAL_DEFAULTS, resolvePolicy } from '../../backend/services/tool-policy.js';

const at = (seconds) => new Date(Date.UTC(2026, 7, 12, 0, 0, seconds)).toISOString();

const rawState = (sampledAt, overrides = {}) => ({
  sampledAt,
  scene: 'Flight',
  paused: false,
  universalTime: 1000,
  vesselId: '42',
  name: 'Agency I',
  situation: 'Flying',
  mass: 12_000,
  dryMass: 5_000,
  thrust: 200_000,
  availableThrust: 220_000,
  maxThrust: 250_000,
  meanAltitude: 10_000,
  surfaceAltitude: 9_950,
  velocity: [100, 200, 300],
  speed: 374.17,
  horizontalSpeed: 360,
  verticalSpeed: 100,
  pitch: 10,
  heading: 90,
  roll: 0,
  bodyName: 'Kerbin',
  apoapsisAltitude: 80_000,
  periapsisAltitude: -200_000,
  orbitRadius: 610_000,
  eccentricity: 0.2,
  inclinationRadians: Math.PI / 6,
  orbitPeriod: 1800,
  timeToApoapsis: 200,
  timeToPeriapsis: 1100,
  resources: {
    LiquidFuel: { amount: 90, capacity: 100 },
    Oxidizer: { amount: 110, capacity: 120 },
    ElectricCharge: { amount: 40, capacity: 50 },
  },
  localGravity: 9,
  gForce: 1.5,
  atmosphereDensity: 0.3,
  staticPressure: 40_000,
  dynamicPressure: 8_000,
  temperature: 260,
  mach: 1.1,
  throttle: 0.75,
  controlPitch: 0,
  controlYaw: 0,
  controlRoll: 0,
  currentStage: 3,
  gear: false,
  brakes: false,
  sas: true,
  rcs: false,
  parachutes: false,
  autopilotEngaged: false,
  ...overrides,
});

const packet = (seconds, overrides = {}, context = {}) => buildTelemetryPacket(
  rawState(at(seconds), overrides),
  { sequence: seconds + 1, endpoint: '127.0.0.1:50000', ...context },
);

describe('Cael-v1 KSP sensing', () => {
  it('shapes one stable state packet without losing physical units', () => {
    const state = packet(0);
    expect(state.protocol).toBe('veris-v1');
    expect(state.game.endpoint).toBe('127.0.0.1:50000');
    expect(state.vessel.name).toBe('Agency I');
    expect(state.vessel.velocity.surfaceMps).toEqual([100, 200, 300]);
    expect(state.vessel.orbit.inclinationDeg).toBeCloseTo(30);
    expect(state.vessel.resources.LiquidFuel.fraction).toBe(0.9);
    expect(state.vessel.environment.localGravityG).toBeCloseTo(9 / 9.80665);
    expect(Object.isFrozen(state.vessel)).toBe(true);
  });

  it('derives stage, flameout, vacuum, high-G, depletion, and orbit events from deltas', () => {
    const before = packet(0);
    const after = packet(1, {
      situation: 'Orbiting',
      currentStage: 2,
      availableThrust: 0,
      staticPressure: 0,
      gForce: 5.5,
      resources: {
        LiquidFuel: { amount: 0, capacity: 100 },
        Oxidizer: { amount: 110, capacity: 120 },
        ElectricCharge: { amount: 40, capacity: 50 },
      },
    });
    const types = deriveFlightEvents(before, after).map((entry) => entry.type);
    expect(types).toEqual(expect.arrayContaining([
      'situation_changed', 'stage_changed', 'engine_flameout', 'vacuum_entered',
      'high_g', 'orbit_achieved', 'resource_depleted',
    ]));
  });
});

describe('KSP command validation and consequence', () => {
  it('accepts bounded deterministic controls and rejects hidden or malformed intents', () => {
    expect(validateKspCommand({
      command: 'set_axes', pitch: -0.5, roll: 1, durationMs: 500, reason: 'arrest the roll',
    })).toMatchObject({ command: 'set_axes', pitch: -0.5, roll: 1, durationMs: 500 });
    expect(() => validateKspCommand({ command: 'burn_to_intercept', reason: 'go to the Mun' })).toThrow(/unsupported/);
    expect(() => validateKspCommand({ command: 'set_throttle', value: 2, reason: 'more' })).toThrow(/between 0 and 1/);
    expect(() => validateKspCommand({ command: 'stage', reason: '', expected: {} })).toThrow(/reason/);
    expect(() => validateKspCommand({ command: 'stage', reason: 'ignite', expected: { magic: 1 } })).toThrow(/unsupported expected/);
  });

  it('combines command setpoints with forecasts and measures angular wrap correctly', () => {
    const before = packet(0, { heading: 350, currentStage: 4 });
    const command = validateKspCommand({
      command: 'maintain_attitude', pitchDeg: 10, headingDeg: 359, rollDeg: 0,
      reason: 'hold prograde corridor', expected: { altitudeM: 10_020 },
    });
    const expected = expectedForCommand(command, before);
    const observed = packet(1, { pitch: 12, heading: 1, roll: 1, meanAltitude: 10_025 });
    const delta = measureCommandDelta(expected, observed);
    expect(delta.status).toBe('within_tolerance');
    expect(delta.fields.find((entry) => entry.field === 'headingDeg').delta).toBe(2);

    const unstable = measureCommandDelta({ pitchDeg: 10 }, packet(2, { pitch: 45 }));
    expect(unstable.status).toBe('diverged');
    expect(unstable.fields[0]).toMatchObject({ actual: 45, delta: 35, withinTolerance: false });
  });
});

describe('KSP rolling black box and portable benchmark', () => {
  it('retains thirty seconds while lifetime metrics survive compaction', () => {
    const owner = { neumaId: 'cael', name: 'Cael', sessionId: 'night-flight' };
    let record = startFlightRecord(packet(0), owner);
    record = advanceFlightRecord(record, packet(10, { meanAltitude: 20_000, speed: 500, gForce: 3 }), []);
    record = appendFlightCommand(record, Object.freeze({
      id: 'command-1', issuedAt: at(10), command: 'stage', delta: { status: 'within_tolerance' },
    }));
    record = advanceFlightRecord(record, packet(31, {
      situation: 'Orbiting', meanAltitude: 75_000, apoapsisAltitude: 90_000, speed: 2_300, gForce: 2,
    }), []);

    expect(record.frames.map((frame) => frame.sampledAt)).toEqual([at(10), at(31)]);
    expect(record.commands).toHaveLength(1);
    expect(record.metrics).toMatchObject({
      maxAltitudeM: 75_000, maxApoapsisM: 90_000, maxSpeedMps: 2_300,
      maxExperiencedG: 3, orbitAchieved: true, commandCount: 1,
    });

    const run = finalizeFlightRecord(record, 'flight_ended:SpaceCenter', at(32), 1032);
    expect(run.participant.neumaId).toBe('cael');
    expect(run.game).toMatchObject({ outcome: 'survived', durationS: 32 });
    expect(run.blackBox.windowSeconds).toBe(30);
    const summary = portableKspSummary(run, '2026-08-12-run');
    expect(summary.id).toBe('2026-08-12-run');
    expect(summary).not.toHaveProperty('blackBox');
  });
});

describe('KSP sovereign tool surface', () => {
  it('maps OBSERVE, ASK, and AUTO onto human, shared, and autonomous control', () => {
    const policy = resolvePolicy(GLOBAL_DEFAULTS);
    expect(checkToolAccess(policy, 'ksp', 'get_telemetry')).toBe('allowed');
    // Acting is the ksp/command INTENT (Stage 3) — its row lives on the
    // intents server and carries the same ask-first tier the tool had.
    expect(checkToolAccess(policy, 'intents', 'ksp.command')).toBe('approval_required');
    expect(applyToolMode('allowed', 'observe', 'get_telemetry')).toBe('allowed');
    expect(applyToolMode('approval_required', 'observe', 'ksp.command')).toBe('denied');
    expect(applyToolMode('approval_required', 'ask', 'ksp.command')).toBe('approval_required');
    expect(applyToolMode('approval_required', 'auto', 'ksp.command')).toBe('allowed');
  });

  // Two read tools, not three: `send_command` became the ksp/command intent.
  // The property under test is the CUSTODY wall — a sealed witness is
  // advertised NOTHING here, because a flight surface belongs to a being on
  // the operator's own substrate.
  it('advertises the two reads only to neuma custody and recognizes both call dialects', () => {
    const neuma = { companion: { neumaId: 'cael', participantKind: 'neuma' } };
    const witness = { companion: { neumaId: 'witness-openai-Sol', participantKind: 'witness' } };
    expect(kspToolsFor(neuma).map((tool) => `${tool.server}/${tool.name}`)).toEqual([
      'ksp/get_telemetry', 'ksp/get_view',
    ]);
    expect(kspToolsFor(witness)).toEqual([]);
    expect(isKspTool({ tool: 'ksp/get_telemetry' })).toBe(true);
    expect(isKspTool({ tool: 'ksp/get_view' })).toBe(true);
    expect(isKspTool({ toolName: 'ksp__send_command' })).toBe(false); // the intent now
  });
});
