import net from 'node:net';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_RPC_PORT = 50000;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

const asBigInt = (value) => {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error('varint value must be non-negative');
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('varint value must be a non-negative safe integer');
  return BigInt(value);
};

/** Encode one unsigned Protocol Buffers varint. Pure. */
export const encodeVarint = (value) => {
  let remaining = asBigInt(value);
  const bytes = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0n);
  return Buffer.from(bytes);
};

/** Decode one varint at an offset, or null while the buffer is incomplete. Pure. */
export const readVarint = (buffer, offset = 0) => {
  let value = 0n;
  let shift = 0n;
  for (let index = offset; index < buffer.length && index < offset + 10; index += 1) {
    const byte = buffer[index];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, bytes: index - offset + 1 };
    shift += 7n;
  }
  if (buffer.length - offset >= 10) throw new Error('invalid protobuf varint');
  return null;
};

const tag = (field, wire) => encodeVarint((field << 3) | wire);
const scalarField = (field, value) => Buffer.concat([tag(field, 0), encodeVarint(value)]);
const bytesField = (field, value) => {
  const data = Buffer.from(value);
  return Buffer.concat([tag(field, 2), encodeVarint(data.length), data]);
};
const stringField = (field, value) => bytesField(field, Buffer.from(value, 'utf8'));

const parseFields = (buffer) => {
  const fields = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset);
    if (!key) throw new Error('truncated protobuf field tag');
    offset += key.bytes;
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    let value;
    if (wire === 0) {
      const parsed = readVarint(buffer, offset);
      if (!parsed) throw new Error('truncated protobuf varint field');
      value = parsed.value;
      offset += parsed.bytes;
    } else if (wire === 1) {
      if (offset + 8 > buffer.length) throw new Error('truncated protobuf 64-bit field');
      value = buffer.subarray(offset, offset + 8);
      offset += 8;
    } else if (wire === 2) {
      const size = readVarint(buffer, offset);
      if (!size) throw new Error('truncated protobuf length');
      offset += size.bytes;
      const length = Number(size.value);
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > buffer.length) {
        throw new Error('invalid protobuf length-delimited field');
      }
      value = buffer.subarray(offset, offset + length);
      offset += length;
    } else if (wire === 5) {
      if (offset + 4 > buffer.length) throw new Error('truncated protobuf 32-bit field');
      value = buffer.subarray(offset, offset + 4);
      offset += 4;
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
    const values = fields.get(field) || [];
    values.push({ wire, value });
    fields.set(field, values);
  }
  return fields;
};

const first = (fields, field) => fields.get(field)?.[0]?.value;
const text = (fields, field) => first(fields, field)?.toString('utf8') || '';

const encodeSigned = (value) => {
  if (!Number.isSafeInteger(value)) throw new Error('signed value must be a safe integer');
  const number = BigInt(value);
  return encodeVarint(number >= 0n ? number * 2n : ((-number) * 2n) - 1n);
};
const decodeSigned = (buffer) => {
  const parsed = readVarint(buffer);
  if (!parsed || parsed.bytes !== buffer.length) throw new Error('invalid signed varint');
  const value = (parsed.value >> 1n) ^ -(parsed.value & 1n);
  return Number(value);
};
const decodeScalarVarint = (buffer) => {
  const parsed = readVarint(buffer);
  if (!parsed || parsed.bytes !== buffer.length) throw new Error('invalid scalar varint');
  return parsed.value;
};

const typeCode = (type) => (typeof type === 'string' ? type : type?.code);

/** Encode a kRPC argument value using its service descriptor type. Pure. */
export const encodeKrpcValue = (type, value) => {
  if (value === null) return Buffer.alloc(0);
  const code = typeCode(type);
  if (code === 'DOUBLE') {
    const out = Buffer.allocUnsafe(8);
    out.writeDoubleLE(value);
    return out;
  }
  if (code === 'FLOAT') {
    const out = Buffer.allocUnsafe(4);
    out.writeFloatLE(value);
    return out;
  }
  if (code === 'SINT32' || code === 'SINT64' || code === 'ENUMERATION') return encodeSigned(value);
  if (code === 'UINT32' || code === 'UINT64' || code === 'CLASS') return encodeVarint(value);
  if (code === 'BOOL') return encodeVarint(value ? 1 : 0);
  if (code === 'STRING' || code === 'BYTES') {
    const data = code === 'STRING' ? Buffer.from(String(value), 'utf8') : Buffer.from(value);
    return Buffer.concat([encodeVarint(data.length), data]);
  }
  throw new Error(`unsupported kRPC argument type ${code || 'unknown'}`);
};

const decodeLengthValue = (buffer) => {
  const size = readVarint(buffer);
  if (!size) throw new Error('truncated kRPC length value');
  const length = Number(size.value);
  if (size.bytes + length !== buffer.length) throw new Error('invalid kRPC length value');
  return buffer.subarray(size.bytes);
};

const decodeCollection = (type, buffer) => {
  const itemType = type?.types?.[0];
  return (parseFields(buffer).get(1) || []).map(({ value }) => decodeKrpcValue(itemType, value));
};

const decodeStatus = (buffer) => {
  const fields = parseFields(buffer);
  return Object.freeze({ version: text(fields, 1) });
};

/** Decode a kRPC return value using its service descriptor type. Pure. */
export const decodeKrpcValue = (type, buffer) => {
  const code = typeCode(type);
  if (!buffer || buffer.length === 0) return code === 'NONE' || !code ? undefined : null;
  if (code === 'DOUBLE') {
    if (buffer.length !== 8) throw new Error('invalid kRPC double');
    return buffer.readDoubleLE(0);
  }
  if (code === 'FLOAT') {
    if (buffer.length !== 4) throw new Error('invalid kRPC float');
    return buffer.readFloatLE(0);
  }
  if (code === 'SINT32' || code === 'SINT64' || code === 'ENUMERATION') return decodeSigned(buffer);
  if (code === 'UINT32') return Number(decodeScalarVarint(buffer));
  if (code === 'UINT64' || code === 'CLASS') return decodeScalarVarint(buffer);
  if (code === 'BOOL') return decodeScalarVarint(buffer) !== 0n;
  if (code === 'STRING') return decodeLengthValue(buffer).toString('utf8');
  if (code === 'BYTES') return decodeLengthValue(buffer);
  if (code === 'TUPLE' || code === 'LIST' || code === 'SET') return decodeCollection(type, buffer);
  if (code === 'STATUS') return decodeStatus(buffer);
  if (code === 'NONE' || !code) return undefined;
  throw new Error(`unsupported kRPC return type ${code}`);
};

const encodeArgument = ({ position, type, value }) => Buffer.concat([
  scalarField(1, position),
  bytesField(2, encodeKrpcValue(type, value)),
]);

/** Encode a complete kRPC Request message. Pure. */
export const encodeRequest = (calls) => Buffer.concat(calls.map((call) => {
  const parts = [stringField(1, call.service), stringField(2, call.procedure)];
  for (const argument of call.arguments || []) parts.push(bytesField(3, encodeArgument(argument)));
  return bytesField(1, Buffer.concat(parts));
}));

const decodeError = (buffer) => {
  if (!buffer) return null;
  const fields = parseFields(buffer);
  return Object.freeze({
    service: text(fields, 1),
    name: text(fields, 2),
    description: text(fields, 3),
    stackTrace: text(fields, 4),
  });
};

const decodeResult = (buffer) => {
  const fields = parseFields(buffer);
  return Object.freeze({ error: decodeError(first(fields, 1)), value: first(fields, 2) || Buffer.alloc(0) });
};

/** Decode a complete kRPC Response message. Pure. */
export const decodeResponse = (buffer) => {
  const fields = parseFields(buffer);
  return Object.freeze({
    error: decodeError(first(fields, 1)),
    results: Object.freeze((fields.get(2) || []).map(({ value }) => decodeResult(value))),
  });
};

const encodeConnectionRequest = (clientName) => Buffer.concat([
  scalarField(1, 0),
  stringField(2, clientName),
]);

const decodeConnectionResponse = (buffer) => {
  const fields = parseFields(buffer);
  return Object.freeze({
    status: fields.has(1) ? Number(first(fields, 1)) : -1,
    message: text(fields, 2),
    clientIdentifier: first(fields, 3) || Buffer.alloc(0),
  });
};

const errorText = (error) => [error?.service, error?.name, error?.description].filter(Boolean).join(': ');

const validatedOptions = (options = {}) => {
  const host = options.host || LOOPBACK_HOST;
  if (host !== LOOPBACK_HOST) throw new Error('KSP kRPC host must be 127.0.0.1');
  const port = Number(options.port ?? process.env.NEUMA_KSP_RPC_PORT ?? DEFAULT_RPC_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('KSP kRPC port must be 1-65535');
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    throw new Error('KSP kRPC timeout must be 100-30000 ms');
  }
  return Object.freeze({ host, port, timeoutMs, clientName: options.clientName || 'Neuma Sovereignty Lab' });
};

/**
 * Minimal serialized kRPC 0.6 TCP client. The game exposes one ordered request/
 * response stream; serialization preserves that causal contract.
 */
export class KspRpcClient {
  constructor(options = {}) {
    this.options = validatedOptions(options);
    this.socket = null;
    this.incoming = Buffer.alloc(0);
    this.frames = [];
    this.waiters = [];
    this.tail = Promise.resolve();
  }

  get endpoint() {
    return `${this.options.host}:${this.options.port}`;
  }

  // impure — opens the real loopback socket and performs the kRPC handshake.
  async connect() {
    if (this.socket && !this.socket.destroyed) return;
    const socket = net.createConnection({ host: this.options.host, port: this.options.port });
    this.socket = socket;
    socket.on('data', (chunk) => this._receive(chunk));
    socket.on('error', (error) => this._failSocket(socket, error));
    socket.on('close', () => this._failSocket(socket, new Error('KSP kRPC connection closed')));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`KSP kRPC connection timed out at ${this.endpoint}`)), this.options.timeoutMs);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    await this._writeFrame(encodeConnectionRequest(this.options.clientName));
    const response = decodeConnectionResponse(await this._readFrame());
    if (response.status !== 0) {
      this.close();
      throw new Error(`KSP kRPC handshake refused: ${response.message || `status ${response.status}`}`);
    }
  }

  // impure — one serialized request against the real game process.
  call(calls) {
    const run = this.tail.catch(() => undefined).then(() => this._callNow(calls));
    this.tail = run.catch(() => undefined);
    return run;
  }

  async _callNow(calls) {
    if (!Array.isArray(calls) || calls.length === 0) throw new Error('kRPC call batch cannot be empty');
    await this.connect();
    try {
      await this._writeFrame(encodeRequest(calls));
      const response = decodeResponse(await this._readFrame());
      if (response.error) throw new Error(`kRPC request failed: ${errorText(response.error)}`);
      if (response.results.length !== calls.length) throw new Error('kRPC response count did not match request count');
      return response.results.map((result, index) => {
        if (result.error) throw new Error(`${calls[index].procedure} failed: ${errorText(result.error)}`);
        return decodeKrpcValue(calls[index].returnType || 'NONE', result.value);
      });
    } catch (error) {
      if (/connection|socket|timed out|ECONN/i.test(error.message)) this.close();
      throw error;
    }
  }

  _receive(chunk) {
    this.incoming = Buffer.concat([this.incoming, chunk]);
    while (this.incoming.length > 0) {
      const size = readVarint(this.incoming);
      if (!size) return;
      const length = Number(size.value);
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_FRAME_BYTES) {
        this._fail(new Error('invalid KSP kRPC frame length'));
        return;
      }
      if (this.incoming.length < size.bytes + length) return;
      const frame = this.incoming.subarray(size.bytes, size.bytes + length);
      this.incoming = this.incoming.subarray(size.bytes + length);
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(frame);
      else this.frames.push(frame);
    }
  }

  _readFrame() {
    const queued = this.frames.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
        reject(new Error('KSP kRPC response timed out'));
      }, this.options.timeoutMs);
      waiter.resolve = (frame) => { clearTimeout(waiter.timer); resolve(frame); };
      this.waiters.push(waiter);
    });
  }

  _writeFrame(message) {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error('KSP kRPC socket is not connected'));
    const frame = Buffer.concat([encodeVarint(message.length), message]);
    return new Promise((resolve, reject) => this.socket.write(frame, (error) => (error ? reject(error) : resolve())));
  }

  _fail(error) {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
  _failSocket(socket, error) {
    if (this.socket !== socket) return;
    this.socket = null;
    this._fail(error);
    if (!socket.destroyed) socket.destroy();
  }


  // impure — releases the real socket and all buffered frames.
  close() {
    const socket = this.socket;
    this.socket = null;
    this.frames = [];
    this.incoming = Buffer.alloc(0);
    this._fail(new Error('KSP kRPC client closed'));
    if (socket && !socket.destroyed) socket.destroy();
  }
}
