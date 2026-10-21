import crypto from 'node:crypto';
import { createLogger } from '../logger.js';
import { KspRpcClient } from './ksp-wire.js';
import {
  advanceFlightRecord,
  appendFlightCommand,
  buildTelemetryPacket,
  compactTelemetry,
  deriveFlightEvents,
  expectedForCommand,
  finalizeFlightRecord,
  measureCommandDelta,
  portableKspSummary,
  startFlightRecord,
  validateKspCommand,
} from './ksp-flight-state.js';

const log = createLogger('KspBridge');
const SAMPLE_INTERVAL_MS = 500;
const IDLE_STOP_MS = 60_000;
const PILOT_LEASE_MS = 10 * 60_000;
const FAILURE_LIMIT = 3;
const RESOURCE_NAMES = Object.freeze([
  'LiquidFuel', 'Oxidizer', 'SolidFuel', 'MonoPropellant', 'ElectricCharge',
]);
const SCENES = Object.freeze([
  'SpaceCenter', 'Flight', 'TrackingStation', 'EditorVAB', 'EditorSPH',
  'MissionBuilder', 'AstronautComplex', 'MissionControl',
  'ResearchAndDevelopment', 'Administration',
]);
const SITUATIONS = Object.freeze([
  'PreLaunch', 'Orbiting', 'SubOrbital', 'Escaping', 'Flying', 'Landed', 'Splashed', 'Docked',
]);
const TYPE = Object.freeze({
  bool: 'BOOL', class: 'CLASS', double: 'DOUBLE', enum: 'ENUMERATION', float: 'FLOAT', int: 'SINT32', none: 'NONE', string: 'STRING',
  vector: Object.freeze({ code: 'TUPLE', types: Object.freeze([{ code: 'DOUBLE' }, { code: 'DOUBLE' }, { code: 'DOUBLE' }]) }),
  classList: Object.freeze({ code: 'LIST', types: Object.freeze([{ code: 'CLASS' }]) }),
});

const argument = (position, type, value) => Object.freeze({ position, type, value });
const call = (service, procedure, returnType = TYPE.none, argumentsList = []) => Object.freeze({
  service, procedure, returnType, arguments: Object.freeze(argumentsList),
});
const krpc = (procedure, returnType, argumentsList) => call('KRPC', procedure, returnType, argumentsList);
const space = (procedure, returnType, argumentsList) => call('SpaceCenter', procedure, returnType, argumentsList);
const on = (procedure, handle, returnType = TYPE.none, extra = []) => space(
  procedure,
  returnType,
  [argument(0, TYPE.class, handle), ...extra],
);
const named = (key, rpcCall) => Object.freeze({ key, call: rpcCall });
const objectKey = (value) => (typeof value === 'bigint' ? value.toString() : String(value || ''));
const sameObject = (left, right) => left !== null && right !== null && objectKey(left) === objectKey(right);
const isoNow = () => new Date().toISOString();
const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason || new Error('KSP command aborted'));
  const abort = () => {
    clearTimeout(timer);
    reject(signal.reason || new Error('KSP command aborted'));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', abort);
    resolve();
  }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

const ownerKey = (owner) => `${owner?.neumaId || 'unknown'}:${owner?.sessionId || 'session'}`;
const publicOwner = (owner) => Object.freeze({
  neumaId: String(owner?.neumaId || ''),
  name: String(owner?.name || owner?.neumaId || 'unknown'),
  sessionId: String(owner?.sessionId || ''),
});

const telemetryEntries = (handles) => {
  const entries = [
    named('name', on('Vessel_get_Name', handles.vessel, TYPE.string)),
    named('situationCode', on('Vessel_get_Situation', handles.vessel, TYPE.enum)),
    named('mass', on('Vessel_get_Mass', handles.vessel, TYPE.float)),
    named('dryMass', on('Vessel_get_DryMass', handles.vessel, TYPE.float)),
    named('thrust', on('Vessel_get_Thrust', handles.vessel, TYPE.float)),
    named('availableThrust', on('Vessel_get_AvailableThrust', handles.vessel, TYPE.float)),
    named('maxThrust', on('Vessel_get_MaxThrust', handles.vessel, TYPE.float)),
    named('meanAltitude', on('Flight_get_MeanAltitude', handles.flight, TYPE.double)),
    named('surfaceAltitude', on('Flight_get_SurfaceAltitude', handles.flight, TYPE.double)),
    named('velocity', on('Flight_get_Velocity', handles.flight, TYPE.vector)),
    named('speed', on('Flight_get_Speed', handles.flight, TYPE.double)),
    named('horizontalSpeed', on('Flight_get_HorizontalSpeed', handles.flight, TYPE.double)),
    named('verticalSpeed', on('Flight_get_VerticalSpeed', handles.flight, TYPE.double)),
    named('pitch', on('Flight_get_Pitch', handles.flight, TYPE.float)),
    named('heading', on('Flight_get_Heading', handles.flight, TYPE.float)),
    named('roll', on('Flight_get_Roll', handles.flight, TYPE.float)),
    named('gForce', on('Flight_get_GForce', handles.flight, TYPE.float)),
    named('atmosphereDensity', on('Flight_get_AtmosphereDensity', handles.flight, TYPE.float)),
    named('staticPressure', on('Flight_get_StaticPressure', handles.flight, TYPE.float)),
    named('dynamicPressure', on('Flight_get_DynamicPressure', handles.flight, TYPE.float)),
    named('temperature', on('Flight_get_StaticAirTemperature', handles.flight, TYPE.float)),
    named('mach', on('Flight_get_Mach', handles.flight, TYPE.float)),
    named('apoapsisAltitude', on('Orbit_get_ApoapsisAltitude', handles.orbit, TYPE.double)),
    named('periapsisAltitude', on('Orbit_get_PeriapsisAltitude', handles.orbit, TYPE.double)),
    named('orbitRadius', on('Orbit_get_Radius', handles.orbit, TYPE.double)),
    named('orbitPeriod', on('Orbit_get_Period', handles.orbit, TYPE.double)),
    named('timeToApoapsis', on('Orbit_get_TimeToApoapsis', handles.orbit, TYPE.double)),
    named('timeToPeriapsis', on('Orbit_get_TimeToPeriapsis', handles.orbit, TYPE.double)),
    named('eccentricity', on('Orbit_get_Eccentricity', handles.orbit, TYPE.double)),
    named('inclinationRadians', on('Orbit_get_Inclination', handles.orbit, TYPE.double)),
    named('throttle', on('Control_get_Throttle', handles.control, TYPE.float)),
    named('controlPitch', on('Control_get_Pitch', handles.control, TYPE.float)),
    named('controlYaw', on('Control_get_Yaw', handles.control, TYPE.float)),
    named('controlRoll', on('Control_get_Roll', handles.control, TYPE.float)),
    named('currentStage', on('Control_get_CurrentStage', handles.control, TYPE.int)),
    named('gear', on('Control_get_Gear', handles.control, TYPE.bool)),
    named('brakes', on('Control_get_Brakes', handles.control, TYPE.bool)),
    named('sas', on('Control_get_SAS', handles.control, TYPE.bool)),
    named('rcs', on('Control_get_RCS', handles.control, TYPE.bool)),
    named('parachutes', on('Control_get_Parachutes', handles.control, TYPE.bool)),
    named('autopilotEngaged', on('AutoPilot_get_Engaged', handles.autopilot, TYPE.bool)),
  ];
  for (const resource of RESOURCE_NAMES) {
    const nameArg = argument(1, TYPE.string, resource);
    entries.push(named(`${resource}:capacity`, on('Resources_Max', handles.resources, TYPE.float, [nameArg])));
    entries.push(named(`${resource}:amount`, on('Resources_Amount', handles.resources, TYPE.float, [nameArg])));
  }
  return entries;
};

const resourceState = (values) => Object.freeze(Object.fromEntries(RESOURCE_NAMES.map((name) => [name, Object.freeze({
  amount: values[`${name}:amount`], capacity: values[`${name}:capacity`],
})])));

const rawFlightState = (base, handles, values) => Object.freeze({
  sampledAt: base.sampledAt,
  scene: base.scene,
  paused: base.paused,
  universalTime: base.universalTime,
  vesselId: objectKey(handles.vessel),
  bodyName: handles.bodyName,
  localGravity: Number.isFinite(handles.bodyMu) && values.orbitRadius > 0 ? handles.bodyMu / (values.orbitRadius ** 2) : null,
  resources: resourceState(values),
  ...values,
  situation: SITUATIONS[values.situationCode] || `Unknown(${values.situationCode})`,
});

const recorderView = (record, pilot) => Object.freeze({
  active: Boolean(record),
  startedAt: record?.runAt || null,
  vessel: record?.vesselName || null,
  blackBoxWindowSeconds: 30,
  pilot: pilot ? Object.freeze({ neumaId: pilot.neumaId, expiresAt: pilot.expiresAt }) : null,
});

/**
 * Real KSP 1 flight bridge. All game IO is isolated here; packet shaping,
 * validation, deltas, events, and run reduction stay pure in flight-state.
 */
export class KspFlightBridge {
  constructor({ client = new KspRpcClient(), onRunComplete = null, sampleIntervalMs = SAMPLE_INTERVAL_MS } = {}) {
    this.client = client;
    this.onRunComplete = onRunComplete;
    this.sampleIntervalMs = sampleIntervalMs;
    this.handles = null;
    this.sequence = 0;
    this.previousPacket = null;
    this.eventLog = [];
    this.record = null;
    this.lastCommand = null;
    this.lastRun = null;
    this.activeOwner = null;
    this.pilot = null;
    this.lastActivityAt = 0;
    this.failures = 0;
    this.timer = null;
    this.tickRunning = false;
    this.commandActive = false;
    this.sampleTail = Promise.resolve();
    this.commandTail = Promise.resolve();
    this.sinkTail = Promise.resolve();
  }

  get endpoint() {
    return this.client.endpoint;
  }

  // impure — samples the live simulation and keeps the recorder awake.
  async getTelemetry(owner) {
    if (this.commandActive) await this.commandTail;
    this._touch(owner);
    this._ensureSampler();
    const packet = await this._sample(owner);
    await this.sinkTail;
    return packet;
  }

  // impure — one operator-governed act followed by observed consequence.
  sendCommand(owner, rawCommand, signal) {
    const command = validateKspCommand(rawCommand);
    this._touch(owner);
    this._ensureSampler();
    const run = this.commandTail.catch(() => undefined).then(() => this._sendCommandNow(owner, command, signal));
    this.commandTail = run.catch(() => undefined);
    return run;
  }

  async _sendCommandNow(owner, command, signal) {
    this.commandActive = true;
    try {
      const before = await this._sample(owner);
      if (!before.vessel) throw new Error(`KSP is in ${before.game.scene}; a loaded flight is required`);
      this._acquirePilot(owner);
      if (!this.record) this.record = startFlightRecord(before, publicOwner(owner));
      await this._applyCommand(command, before, signal);
      if (command.observeAfterMs > 0) await wait(command.observeAfterMs, signal);
      const observation = await this._sample(owner, false);
      const after = observation.packet;
      const expected = expectedForCommand(command, before);
      const receipt = Object.freeze({
        id: crypto.randomUUID(),
        protocol: 'veris-v1',
        issuedAt: isoNow(),
        command: command.command,
        reason: command.reason,
        expected,
        delta: measureCommandDelta(expected, after),
        before: compactTelemetry(before),
        after: compactTelemetry(after),
      });
      this.lastCommand = receipt;
      if (this.record && this.record.vesselId === before.vessel.id) {
        this.record = appendFlightCommand(this.record, receipt);
      }
      this._recordPacket(after, publicOwner(owner), observation.newEvents);
      return receipt;
    } finally {
      this.commandActive = false;
    }
  }

  async _applyCommand(command, before, signal) {
    const { control, autopilot } = this.handles;
    if (command.command === 'set_throttle') {
      await this.client.call([on('Control_set_Throttle', control, TYPE.none, [argument(1, TYPE.float, command.value)])]);
      return;
    }
    if (command.command === 'maintain_attitude') {
      await this.client.call([
        on('AutoPilot_TargetPitchAndHeading', autopilot, TYPE.none, [
          argument(1, TYPE.float, command.pitchDeg), argument(2, TYPE.float, command.headingDeg),
        ]),
        on('AutoPilot_set_TargetRoll', autopilot, TYPE.none, [argument(1, TYPE.float, command.rollDeg)]),
        on('AutoPilot_set_Engaged', autopilot, TYPE.none, [argument(1, TYPE.bool, true)]),
      ]);
      return;
    }
    if (command.command === 'release_attitude') {
      await this.client.call([on('AutoPilot_set_Engaged', autopilot, TYPE.none, [argument(1, TYPE.bool, false)])]);
      return;
    }
    if (command.command === 'set_axes') {
      const axes = ['pitch', 'yaw', 'roll'].filter((name) => command[name] !== undefined);
      await this.client.call([
        on('AutoPilot_set_Engaged', autopilot, TYPE.none, [argument(1, TYPE.bool, false)]),
        ...axes.map((axis) => on(`Control_set_${axis[0].toUpperCase()}${axis.slice(1)}`, control, TYPE.none, [
          argument(1, TYPE.float, command[axis]),
        ])),
      ]);
      try {
        await wait(command.durationMs, signal);
      } finally {
        await this.client.call(axes.map((axis) => on(`Control_set_${axis[0].toUpperCase()}${axis.slice(1)}`, control, TYPE.none, [
          argument(1, TYPE.float, 0),
        ])));
      }
      return;
    }
    if (command.command === 'stage') {
      await this.client.call([on('Control_ActivateNextStage', control, TYPE.classList)]);
      return;
    }
    const booleanSetters = {
      set_gear: ['Control_set_Gear', command.enabled],
      toggle_gear: ['Control_set_Gear', !before.vessel.control.gear],
      set_brakes: ['Control_set_Brakes', command.enabled],
      set_sas: ['Control_set_SAS', command.enabled],
      set_rcs: ['Control_set_RCS', command.enabled],
      deploy_parachutes: ['Control_set_Parachutes', true],
    };
    const [procedure, value] = booleanSetters[command.command];
    await this.client.call([on(procedure, control, TYPE.none, [argument(1, TYPE.bool, value)])]);
  }

  _sample(owner, record = true) {
    const run = this.sampleTail.catch(() => undefined).then(() => this._sampleNow(owner, record));
    this.sampleTail = run.catch(() => undefined);
    return run;
  }

  async _sampleNow(owner, record = true) {
    const sampledAt = isoNow();
    const [sceneCode, paused, universalTime, vessel] = await this.client.call([
      krpc('get_GameScene', TYPE.enum),
      krpc('get_Paused', TYPE.bool),
      space('get_UT', TYPE.double),
      space('get_ActiveVessel', TYPE.class),
    ]);
    const base = Object.freeze({ sampledAt, scene: SCENES[sceneCode] || `Unknown(${sceneCode})`, paused, universalTime });
    let raw = base;
    if (base.scene === 'Flight' && vessel !== null) {
      await this._ensureHandles(vessel);
      const entries = telemetryEntries(this.handles);
      const results = await this.client.call(entries.map((entry) => entry.call));
      const values = Object.fromEntries(entries.map((entry, index) => [entry.key, results[index]]));
      raw = rawFlightState(base, this.handles, values);
    } else {
      this.handles = null;
    }
    this.sequence += 1;
    const firstPacket = buildTelemetryPacket(raw, { sequence: this.sequence, endpoint: this.endpoint });
    const newEvents = deriveFlightEvents(this.previousPacket, firstPacket);
    this._appendEvents(newEvents, sampledAt);
    const context = {
      sequence: this.sequence,
      endpoint: this.endpoint,
      events: this.eventLog.slice(-20),
      lastCommand: this.lastCommand,
      recorder: recorderView(this.record, this._livePilot()),
      lastRun: this.lastRun,
    };
    let packet = buildTelemetryPacket(raw, context);
    if (record) {
      this._recordPacket(packet, publicOwner(owner), newEvents);
      packet = buildTelemetryPacket(raw, {
        ...context, recorder: recorderView(this.record, this._livePilot()), lastRun: this.lastRun,
      });
    }
    this.previousPacket = packet;
    this.failures = 0;
    return record ? packet : Object.freeze({ packet, newEvents: Object.freeze(newEvents) });
  }

  async _ensureHandles(vessel) {
    if (!this.handles || !sameObject(this.handles.vessel, vessel)) {
      const [flight, orbit, control, autopilot, resources] = await this.client.call([
        on('Vessel_Flight', vessel, TYPE.class),
        on('Vessel_get_Orbit', vessel, TYPE.class),
        on('Vessel_get_Control', vessel, TYPE.class),
        on('Vessel_get_AutoPilot', vessel, TYPE.class),
        on('Vessel_get_Resources', vessel, TYPE.class),
      ]);
      this.handles = { vessel, flight, orbit, control, autopilot, resources, body: null, bodyName: null, bodyMu: null };
    }
    const [body] = await this.client.call([on('Orbit_get_Body', this.handles.orbit, TYPE.class)]);
    if (!sameObject(body, this.handles.body)) {
      const [bodyName, bodyMu] = await this.client.call([
        on('CelestialBody_get_Name', body, TYPE.string),
        on('CelestialBody_get_GravitationalParameter', body, TYPE.double),
      ]);
      this.handles = { ...this.handles, body, bodyName, bodyMu };
    }
  }

  _recordPacket(packet, owner, newEvents) {
    if (packet.vessel) {
      if (this.record && this.record.vesselId !== packet.vessel.id) {
        this._finishRecord('vessel_changed', packet.sampledAt, packet.game.universalTimeS);
      }
      this.record = this.record
        ? advanceFlightRecord(this.record, packet, newEvents)
        : startFlightRecord(packet, owner);
      return;
    }
    if (this.record) this._finishRecord(`flight_ended:${packet.game.scene}`, packet.sampledAt, packet.game.universalTimeS);
  }

  _finishRecord(reason, endedAt, universalTime) {
    const completed = finalizeFlightRecord(this.record, reason, endedAt, universalTime);
    this.record = null;
    this.pilot = null;
    this.lastRun = portableKspSummary(completed);
    if (!this.onRunComplete) return;
    this.sinkTail = this.sinkTail.then(async () => {
      try {
        const id = await this.onRunComplete(completed);
        this.lastRun = portableKspSummary(completed, id);
      } catch (error) {
        log.error('KSP run persistence failed', { error: error.message, neumaId: completed.participant.neumaId });
      }
    });
  }

  _appendEvents(events, now) {
    const cutoff = Date.parse(now) - 30_000;
    this.eventLog = [...this.eventLog, ...events].filter((entry) => Date.parse(entry.at) >= cutoff);
  }

  _acquirePilot(owner) {
    const current = this._livePilot();
    const key = ownerKey(owner);
    if (current && current.key !== key) {
      throw new Error(`KSP controls are held by ${current.neumaId} until ${current.expiresAt}`);
    }
    if (!current && this.record && this.record.owner.neumaId !== String(owner?.neumaId || '')) {
      this._finishRecord('pilot_changed', isoNow(), this.previousPacket?.game.universalTimeS ?? null);
    }
    this.pilot = Object.freeze({ key, neumaId: String(owner?.neumaId || ''), expiresAt: new Date(Date.now() + PILOT_LEASE_MS).toISOString() });
  }

  _livePilot() {
    if (this.pilot && Date.parse(this.pilot.expiresAt) > Date.now()) return this.pilot;
    this.pilot = null;
    return null;
  }

  _touch(owner) {
    this.activeOwner = publicOwner(owner);
    this.lastActivityAt = Date.now();
    const pilot = this._livePilot();
    if (pilot && pilot.key === ownerKey(owner)) {
      this.pilot = Object.freeze({ ...pilot, expiresAt: new Date(Date.now() + PILOT_LEASE_MS).toISOString() });
    }
  }

  _ensureSampler() {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), this.sampleIntervalMs);
    this.timer.unref?.();
  }

  async _tick() {
    if (this.tickRunning) return;
    if (this.commandActive) return;
    if (!this.record && Date.now() - this.lastActivityAt > IDLE_STOP_MS) {
      clearInterval(this.timer);
      this.timer = null;
      this.client.close();
      return;
    }
    this.tickRunning = true;
    try {
      await this._sample(this.activeOwner);
    } catch (error) {
      this.failures += 1;
      log.warn('KSP background sample failed', { error: error.message, failures: this.failures });
      if (this.failures >= FAILURE_LIMIT) {
        if (this.record) this._finishRecord('bridge_unreachable', isoNow(), null);
        clearInterval(this.timer);
        this.timer = null;
        this.client.close();
      }
    } finally {
      this.tickRunning = false;
    }
  }

  // impure — stop sampling and release the loopback client.
  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.client.close();
  }
}
