import path from 'node:path';
import { validateRefinementExecutionEnvelope } from '../../core/refinement/training-authority-contract.js';
import {
  MAX_REFINEMENT_TRAINER_FACTS_BYTES,
  trainerArguments,
  trainerInspectionArguments,
} from './refinement-trainer-facts.js';
import { validateRefinementGpuLease } from './refinement-gpu-lease-contract.js';
import { withTargetTrainingSnapshotFiles } from './refinement-target-snapshot-authority.js';
import {
  refinementChildEnvironment,
  withRefinementExecutionSpawnAuthority,
} from './refinement-execution-authority.js';
import {
  assertRefinementTrainingMaterializedRoots,
  sealRefinementTrainingMaterializedRoots,
  verifyRefinementTrainingMaterializerAfterReap,
  verifyRefinementTrainingWorkFilesAfterReap,
  verifyRefinementTrainingWorkFilesBeforeSpawn,
} from './refinement-training-work-files.js';
import { withRefinementTrainingCorpusDescriptor } from './refinement-training-corpus-authority.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import { codedTrainingError } from './refinement-training-errors.js';
import { runRefinementProcessScope } from './refinement-process-scope.js';

const SANDBOX_WORK = '/work';
const SANDBOX_SNAPSHOT = '/snapshot';
const MAX_PATH_BYTES = 512;
const FIXED_WORKLOAD_DESCRIPTORS = 15;
const SHA256 = /^[0-9a-f]{64}$/u;
const ADAPTER_ID = /^[a-z0-9][a-z0-9-]{0,60}$/u;
const GPU_DEVICE = /^\/dev\/nvidia(?:ctl|uvm|uvm-tools|\d+)$/u;
const HOST_IDS = Object.freeze(['hostLdCache', 'hostUsrLib', 'hostUsrLib64', 'hostCuda']);
const WORKLOAD_MODES = new Set(['trainer', 'inspection', 'converter']);

const safeRelativePath = (value) => {
  const parts = typeof value === 'string' ? value.split('/') : [];
  if (!value || path.posix.isAbsolute(value) || value.includes('\\')
    || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES
    || parts.some((part) => !part || part === '.' || part === '..')) {
    throw codedTrainingError('TRAINING_SANDBOX_UNAVAILABLE', 'SNAPSHOT_PATH_INVALID');
  }
  return value;
};

const assertPacked = (authority, kind) => {
  if (authority?.kind !== 'borrowed-packed-refinement-authority-v2'
    || authority.manifestKind !== kind || typeof authority.verify !== 'function'
    || !SHA256.test(String(authority.manifestSha256 || ''))
    || !Array.isArray(authority.files) || authority.fileCount !== authority.files.length
    || !Number.isSafeInteger(authority.totalBytes) || authority.totalBytes < 1) {
    throw codedTrainingError('TRAINING_EXECUTION_CHANGED', 'PACKED_AUTHORITY_INVALID');
  }
  return authority;
};

const packedDeclaration = (authority) => Object.freeze({
  manifestSha256: authority.manifestSha256,
  fileCount: authority.fileCount,
  totalBytes: authority.totalBytes,
  files: authority.files,
});

const snapshotParts = async (borrowed, operation) => {
  if (!borrowed || !SHA256.test(String(borrowed.manifestSha256 || ''))
    || !borrowed.manifest || !Array.isArray(borrowed.files)
    || borrowed.fileCount !== borrowed.files.length) {
    throw codedTrainingError('TRAINING_BASE_UNAVAILABLE', 'SNAPSHOT_AUTHORITY_INVALID');
  }
  await borrowed.manifest.verify(operation);
  const files = borrowed.files.map((authority) => {
    safeRelativePath(authority.relativePath);
    if (authority.mode !== 0o400 || typeof authority.verify !== 'function') {
      throw codedTrainingError('TRAINING_BASE_UNAVAILABLE', 'SNAPSHOT_FILE_INVALID');
    }
    return authority;
  });
  for (const authority of files) await authority.verify(operation);
  return Object.freeze({
    manifest: borrowed.manifest,
    manifestSha256: borrowed.manifestSha256,
    files: Object.freeze(files),
  });
};

/** Maximum snapshot file descriptors left after the fixed workload chain. Pure. */
const refinementSnapshotDescriptorCapacity = (resources, additionalDescriptors = 0) => {
  const inherited = Math.min(
    resources.maxInheritedFileDescriptors,
    resources.maxOpenFiles - 3,
  );
  return Math.max(0, inherited - FIXED_WORKLOAD_DESCRIPTORS - additionalDescriptors);
};

/** Stable guest paths resolved only from the held execution authority. Pure. */
export const refinementSandboxPaths = (executionAuthority) => {
  const guest = executionAuthority?.guest;
  if (!guest || Object.keys(guest).sort().join(',') !== 'converter,python,trainer'
    || guest.python !== '/runtime/bin/python'
    || guest.trainer !== '/tool/scripts/refinement/train-adapter.py'
    || guest.converter !== '/runtime/bin/convert-lora') {
    throw codedTrainingError('TRAINING_EXECUTION_CHANGED', 'GUEST_PATHS_INVALID');
  }
  return guest;
};

const checkedGpu = async (mode, gpuReservation, executionEnvelope, operation) => {
  if (mode !== 'trainer') {
    return Object.freeze({ lease: null, environment: null, withDevices: null });
  }
  if (!gpuReservation || typeof gpuReservation.assertHeld !== 'function'
    || typeof gpuReservation.withProcessDevices !== 'function'
    || !gpuReservation.gpuLease) {
    throw codedTrainingError('TRAINING_CGROUP_UNAVAILABLE', 'GPU_RESERVATION_REQUIRED');
  }
  await gpuReservation.assertHeld(operation);
  const lease = validateRefinementGpuLease(gpuReservation.gpuLease, Date.now());
  return Object.freeze({
    lease,
    environment: Object.freeze({
      ...refinementChildEnvironment(executionEnvelope),
      CUDA_VISIBLE_DEVICES: lease.gpuUuid,
      NVIDIA_VISIBLE_DEVICES: lease.gpuUuid,
    }),
    withDevices: (consumer) => gpuReservation.withProcessDevices(operation, consumer),
  });
};

const hostEntries = (processAuthority) => HOST_IDS.map((id) => ({
  id,
  authority: processAuthority[id],
}));

const materializerEntries = (processAuthority, workFiles) => [
  { id: 'runtime', authority: processAuthority.runtime },
  { id: 'tool', authority: processAuthority.tool },
  ...hostEntries(processAuthority),
  { id: 'runtimeRoot', authority: workFiles.runtimeRoot },
  { id: 'toolRoot', authority: workFiles.toolRoot },
];

const workloadEntries = ({ processAuthority, workFiles, snapshot, corpus, devices, mode }) => [
  ...hostEntries(processAuthority),
  { id: 'runtimeRoot', authority: workFiles.runtimeRoot },
  { id: 'toolRoot', authority: workFiles.toolRoot },
  { id: 'adapterHfRoot', authority: workFiles.adapterHfRoot },
  ...(mode === 'converter' ? [{ id: 'adapter', authority: workFiles.adapter }] : [
    { id: 'facts', authority: workFiles.facts },
    { id: 'corpus', authority: corpus },
    { id: 'snapshotManifest', authority: snapshot.manifest },
    ...snapshot.files.map((authority, index) => ({ id: `snapshot${index}`, authority })),
  ]),
  ...devices.map((device, index) => ({ id: `gpuDevice${index}`, authority: device.authority })),
];

const procFd = (fd) => `/proc/self/fd/${fd}`;
const environmentArguments = (environment) => Object.entries(environment)
  .sort(([left], [right]) => left.localeCompare(right))
  .flatMap(([key, value]) => ['--setenv', key, value]);
const keepArguments = (byId) => Object.values(byId)
  .sort((left, right) => left - right)
  .flatMap((fd) => ['--keep-fd', String(fd)]);

const baseSandboxArguments = (byId) => [
  '--die-with-parent', '--new-session', '--unshare-all', '--cap-drop', 'ALL',
  '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', SANDBOX_WORK,
  '--dir', '/home', '--dir', '/root', '--dir', '/run',
  '--dir', '/usr', '--dir', '/usr/local', '--dir', '/etc',
  '--ro-bind', procFd(byId.hostUsrLib), '/usr/lib',
  '--ro-bind', procFd(byId.hostUsrLib64), '/usr/lib64',
  '--ro-bind', procFd(byId.hostCuda), '/usr/local/cuda',
  '--ro-bind', procFd(byId.hostLdCache), '/etc/ld.so.cache',
  '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
];

const archiveArguments = (authority, destination, fd) => [
  '--archive', destination, String(fd), authority.sha256, String(authority.bytes),
  String(authority.fileCount), authority.manifestSha256, authority.manifestKind,
];

const materializerArguments = ({ byId, processAuthority, environment }) => [
  ...baseSandboxArguments(byId),
  ...keepArguments(byId),
  '--clearenv',
  ...environmentArguments(environment),
  '--',
  procFd(byId.consumerPython),
  procFd(byId.consumerScript),
  ...archiveArguments(processAuthority.runtime, 'runtime', byId.runtime),
  ...archiveArguments(processAuthority.tool, 'tool', byId.tool),
  '--root', 'runtime', String(byId.runtimeRoot),
  '--root', 'tool', String(byId.toolRoot),
];

const snapshotDirectories = (files) => [...new Set(files.flatMap(({ relativePath }) => {
  const parts = relativePath.split('/').slice(0, -1);
  return parts.map((_, index) => `${SANDBOX_SNAPSHOT}/${parts.slice(0, index + 1).join('/')}`);
}))].sort((left, right) => left.split('/').length - right.split('/').length
  || Buffer.compare(Buffer.from(left), Buffer.from(right)));

const workloadArguments = ({
  byId, snapshot, command, environment, devices, mode, adapterId,
}) => {
  const args = [
    ...baseSandboxArguments(byId),
    '--ro-bind', procFd(byId.runtimeRoot), '/runtime',
    '--ro-bind', procFd(byId.toolRoot), '/tool',
  ];
  if (mode === 'converter') {
    args.push('--ro-bind', procFd(byId.adapterHfRoot), `${SANDBOX_WORK}/adapter-hf`);
    args.push('--bind', procFd(byId.adapter), `${SANDBOX_WORK}/${adapterId}.gguf`);
  } else {
    const output = mode === 'inspection' ? 'unused-adapter' : 'adapter-hf';
    args.push('--bind', procFd(byId.adapterHfRoot), `${SANDBOX_WORK}/${output}`);
    args.push('--dir', SANDBOX_SNAPSHOT);
    for (const directory of snapshotDirectories(snapshot.files)) args.push('--dir', directory);
    snapshot.files.forEach((file, index) => {
      args.push('--ro-bind', procFd(byId[`snapshot${index}`]),
        `${SANDBOX_SNAPSHOT}/${file.relativePath}`);
    });
    args.push('--remount-ro', SANDBOX_SNAPSHOT);
  }
  devices.forEach((device, index) => {
    args.push('--dev-bind', procFd(byId[`gpuDevice${index}`]), device.guestPath);
  });
  const childIds = mode === 'converter'
    ? []
    : ['corpus', 'facts', 'snapshotManifest'];
  args.push(
    ...keepArguments(byId),
    '--clearenv',
    ...environmentArguments(environment),
    '--',
    procFd(byId.consumerPython),
    procFd(byId.consumerScript),
    '--command', JSON.stringify(command),
  );
  for (const id of childIds) args.push('--child-fd', String(byId[id]));
  return args;
};

const workVerifier = (workFiles, executionAuthority, operation) => Object.freeze({
  verifyBeforeSpawn: () => verifyRefinementTrainingWorkFilesBeforeSpawn(
    workFiles,
    executionAuthority,
    operation,
  ),
  verifyAfterReap: () => verifyRefinementTrainingWorkFilesAfterReap(
    workFiles,
    executionAuthority,
    operation,
  ),
});

const materializerVerifier = (workFiles, executionAuthority, operation) => Object.freeze({
  verifyBeforeSpawn: () => verifyRefinementTrainingWorkFilesBeforeSpawn(
    workFiles,
    executionAuthority,
    operation,
  ),
  verifyAfterReap: () => verifyRefinementTrainingMaterializerAfterReap(
    workFiles,
    executionAuthority,
    operation,
  ),
});

const envelopeFor = (options) => {
  const envelope = validateRefinementExecutionEnvelope(options.executionEnvelope);
  if (options.executionAuthority?.executionEnvelope?.sha256 !== envelope.sha256) {
    throw codedTrainingError('TRAINING_EXECUTION_CHANGED', 'EXECUTION_ENVELOPE_MISMATCH');
  }
  return envelope;
};

/** Materialize the exact packed runtime/tool into parent-held private roots. Impure. */
export const runRefinementMaterializerStep = async (options, onLine = () => {}) => {
  const envelope = envelopeFor(options);
  const operation = assertRefinementProcessOperation(options.operation);
  const environment = refinementChildEnvironment(envelope);
  return withRefinementExecutionSpawnAuthority(
    options.executionAuthority,
    operation,
    async (processAuthority) => {
      const runtime = assertPacked(processAuthority.runtime, 'neuma-runtime-manifest');
      const tool = assertPacked(processAuthority.tool, 'neuma-source-manifest');
      if (runtime.sha256 !== envelope.sandbox.runtimeAuthoritySha256
        || runtime.manifestSha256 !== envelope.sandbox.runtimeManifestSha256
        || tool.sha256 !== envelope.sandbox.toolAuthoritySha256
        || tool.manifestSha256 !== envelope.sandbox.toolManifestSha256) {
        throw codedTrainingError('TRAINING_EXECUTION_CHANGED', 'PACKED_AUTHORITY_MISMATCH');
      }
      const outcome = await runRefinementProcessScope({
        executionAuthority: options.executionAuthority,
        executionEnvelope: envelope,
        processAuthority,
        operation,
        inheritedAuthorities: materializerEntries(processAuthority, options.workFiles),
        verifyWork: materializerVerifier(
          options.workFiles,
          options.executionAuthority,
          operation,
        ),
        programKind: 'sandboxMaterializer',
        buildProgramArguments: (byId) => materializerArguments({
          byId, processAuthority, environment,
        }),
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
      }, onLine);
      await sealRefinementTrainingMaterializedRoots(
        options.workFiles,
        options.executionAuthority,
        operation,
        Object.freeze({
          runtime: packedDeclaration(runtime),
          tool: packedDeclaration(tool),
        }),
      );
      await verifyRefinementTrainingWorkFilesBeforeSpawn(
        options.workFiles,
        options.executionAuthority,
        operation,
      );
      return outcome;
    },
  );
};

const checkedDevices = (mode, borrowedDevices) => {
  if (!Array.isArray(borrowedDevices)) {
    throw codedTrainingError('TRAINING_CGROUP_UNAVAILABLE', 'GPU_DEVICE_BORROW_INVALID');
  }
  const devices = Object.freeze(borrowedDevices.map((device) => {
    if (!GPU_DEVICE.test(String(device?.guestPath || '')) || !device.authority
      || typeof device.authority.verify !== 'function') {
      throw codedTrainingError('TRAINING_CGROUP_UNAVAILABLE', 'GPU_DEVICE_AUTHORITY_INVALID');
    }
    return Object.freeze({
      guestPath: device.guestPath,
      authority: device.authority,
    });
  }));
  if ((mode === 'trainer') !== Boolean(devices.length)) {
    throw codedTrainingError('TRAINING_CGROUP_UNAVAILABLE', 'GPU_LEASE_INVALID');
  }
  return devices;
};

/** Run one sealed trainer/inspection/converter workload through the verified chain. Impure. */
const runRefinementSandboxStep = async (options, onLine = () => {}) => {
  if (!WORKLOAD_MODES.has(options?.mode) || !ADAPTER_ID.test(String(options?.adapterId || ''))
    || typeof options?.buildCommand !== 'function') {
    throw codedTrainingError('TRAINING_PROCESS_FAILED', 'PROCESS_INVOCATION_INVALID');
  }
  const envelope = envelopeFor(options);
  const operation = assertRefinementProcessOperation(options.operation);
  const gpu = await checkedGpu(options.mode, options.gpuReservation, envelope, operation);
  const runWithDevices = async (borrowedDevices = Object.freeze([])) => {
    const devices = checkedDevices(options.mode, borrowedDevices);
    const withCorpus = (consumer) => options.mode === 'converter'
      ? consumer(null)
      : withRefinementTrainingCorpusDescriptor(options.corpusAuthority, operation, consumer);
    return withRefinementExecutionSpawnAuthority(
      options.executionAuthority,
      operation,
      async (processAuthority) => {
        await assertRefinementTrainingMaterializedRoots(
          options.workFiles,
          options.executionAuthority,
          operation,
        );
        return withCorpus((corpusDescriptor) => withTargetTrainingSnapshotFiles(
          options.snapshotAuthority,
          operation,
          async (borrowedSnapshot) => {
            const snapshot = await snapshotParts(borrowedSnapshot, operation);
            const inheritedAuthorities = workloadEntries({
              processAuthority,
              workFiles: options.workFiles,
              snapshot,
              corpus: corpusDescriptor,
              devices,
              mode: options.mode,
            });
            const descriptorLimit = Math.min(
              envelope.resources.maxInheritedFileDescriptors,
              envelope.resources.maxOpenFiles - 3,
            );
            if (snapshot.files.length
                > refinementSnapshotDescriptorCapacity(envelope.resources, devices.length)
              || 5 + inheritedAuthorities.length > descriptorLimit) {
              throw codedTrainingError('TRAINING_SANDBOX_UNAVAILABLE', 'SNAPSHOT_DESCRIPTOR_LIMIT');
            }
            const environment = gpu.environment ?? refinementChildEnvironment(envelope);
            const outcome = await runRefinementProcessScope({
              executionAuthority: options.executionAuthority,
              executionEnvelope: envelope,
              processAuthority,
              operation,
              inheritedAuthorities,
              verifyWork: workVerifier(options.workFiles, options.executionAuthority, operation),
              programKind: 'sandboxWorkload',
              buildProgramArguments: (byId) => {
                const command = options.buildCommand(byId, gpu.lease, snapshot);
                if (!Array.isArray(command) || !command.length
                  || command.some((value) => typeof value !== 'string' || value.includes('\0'))) {
                  throw codedTrainingError('TRAINING_PROCESS_FAILED', 'PROCESS_INVOCATION_INVALID');
                }
                return workloadArguments({
                  byId,
                  snapshot,
                  command,
                  environment,
                  devices,
                  mode: options.mode,
                  adapterId: options.adapterId,
                });
              },
              timeoutMs: options.timeoutMs,
              maxOutputBytes: options.maxOutputBytes,
            }, onLine);
            await verifyRefinementTrainingWorkFilesBeforeSpawn(
              options.workFiles,
              options.executionAuthority,
              operation,
            );
            return outcome;
          },
        ));
      },
    );
  };
  return gpu.withDevices ? gpu.withDevices(runWithDevices) : runWithDevices();
};

/** Run the exact approved trainer with one held GPU reservation. Impure. */
export const runRefinementTrainerStep = (options, onLine = () => {}) => {
  const guest = refinementSandboxPaths(options.executionAuthority);
  return runRefinementSandboxStep({
    ...options,
    mode: 'trainer',
    buildCommand: (byId, gpuLease, snapshot) => [guest.python, ...trainerArguments({
      trainer: guest.trainer,
      corpusFd: byId.corpus,
      corpusSha256: options.corpusAuthority.sha256,
      corpusBytes: options.corpusAuthority.bytes,
      corpusSampleCount: options.corpusAuthority.sampleCount,
      outputPath: `${SANDBOX_WORK}/adapter-hf`,
      factsFd: byId.facts,
      factsMaximumBytes: options.workFiles.facts.maximumBytes,
      snapshotManifestFd: byId.snapshotManifest,
      snapshotManifestSha256: snapshot.manifestSha256,
      config: options.config,
      gpuLease,
    })],
  }, onLine);
};

/** Run tokenizer/model inspection CPU-only through the same held scope. Impure. */
export const runRefinementInspectionStep = (options, onLine = () => {}) => {
  const guest = refinementSandboxPaths(options.executionAuthority);
  return runRefinementSandboxStep({
    ...options,
    mode: 'inspection',
    buildCommand: (byId, gpuLease, snapshot) => [guest.python, ...trainerInspectionArguments({
      trainer: guest.trainer,
      corpusFd: byId.corpus,
      corpusSha256: options.corpusAuthority.sha256,
      corpusBytes: options.corpusAuthority.bytes,
      corpusSampleCount: options.corpusAuthority.sampleCount,
      outputPath: `${SANDBOX_WORK}/unused-adapter`,
      factsFd: byId.facts,
      factsMaximumBytes: options.workFiles.facts.maximumBytes,
      snapshotManifestFd: byId.snapshotManifest,
      snapshotManifestSha256: snapshot.manifestSha256,
      config: options.config,
    })],
  }, onLine);
};

/** Run conversion CPU-only with the held HF input root and precreated adapter file. Impure. */
export const runRefinementConverterStep = (options, onLine = () => {}) => {
  const guest = refinementSandboxPaths(options.executionAuthority);
  return runRefinementSandboxStep({
    ...options,
    mode: 'converter',
    buildCommand: () => [
      guest.python,
      guest.converter,
      `${SANDBOX_WORK}/adapter-hf`,
      '--outfile', `${SANDBOX_WORK}/${options.adapterId}.gguf`,
      '--outtype', 'f16',
    ],
  }, onLine);
};

export { MAX_REFINEMENT_TRAINER_FACTS_BYTES };
