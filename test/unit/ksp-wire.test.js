import { describe, expect, it } from 'vitest';
import {
  decodeKrpcValue,
  decodeResponse,
  encodeKrpcValue,
  encodeRequest,
  encodeVarint,
  readVarint,
} from '../../backend/services/ksp/ksp-wire.js';

const doubleBytes = (value) => {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleLE(value);
  return buffer;
};

const tupleBytes = (values) => Buffer.concat(values.map((value) => Buffer.concat([
  Buffer.from([0x0a, 0x08]),
  doubleBytes(value),
])));

describe('kRPC protobuf wire values', () => {
  it('round-trips unsigned varints across frame boundaries', () => {
    for (const value of [0, 1, 127, 128, 300, Number.MAX_SAFE_INTEGER]) {
      const encoded = encodeVarint(value);
      expect(readVarint(encoded)).toEqual({ value: BigInt(value), bytes: encoded.length });
    }
    expect(readVarint(Buffer.from([0x80]))).toBeNull();
    expect(() => encodeVarint(-1n)).toThrow(/non-negative/);
  });

  it('round-trips every scalar type used by the flight bridge', () => {
    const cases = [
      ['DOUBLE', 12345.678],
      ['FLOAT', 0.625],
      ['SINT32', -17],
      ['ENUMERATION', 7],
      ['UINT32', 4294967295],
      ['UINT64', 9007199254740991n],
      ['CLASS', 998877665544n],
      ['BOOL', true],
      ['STRING', 'Kerbin · Cael'],
      ['BYTES', Buffer.from([0, 1, 255])],
    ];
    for (const [type, value] of cases) {
      expect(decodeKrpcValue(type, encodeKrpcValue(type, value))).toEqual(value);
    }
    expect(decodeKrpcValue('NONE', Buffer.alloc(0))).toBeUndefined();
    expect(decodeKrpcValue('CLASS', Buffer.alloc(0))).toBeNull();
  });

  it('decodes the repeated-bytes tuple representation used by Flight.Velocity', () => {
    const type = { code: 'TUPLE', types: [{ code: 'DOUBLE' }] };
    expect(decodeKrpcValue(type, tupleBytes([1.25, -2.5, 3.75]))).toEqual([1.25, -2.5, 3.75]);
  });

  it('encodes an official ProcedureCall request envelope exactly', () => {
    const request = encodeRequest([{
      service: 'SpaceCenter', procedure: 'get_UT', returnType: 'DOUBLE', arguments: [],
    }]);
    expect(request.toString('hex')).toBe('0a150a0b537061636543656e74657212066765745f5554');
  });

  it('decodes an official Response → ProcedureResult → value envelope', () => {
    const fixture = Buffer.concat([
      Buffer.from([0x12, 0x0a, 0x12, 0x08]),
      doubleBytes(42),
    ]);
    const response = decodeResponse(fixture);
    expect(response.error).toBeNull();
    expect(response.results).toHaveLength(1);
    expect(decodeKrpcValue('DOUBLE', response.results[0].value)).toBe(42);
  });

  it('rejects truncated or overlong scalar encodings', () => {
    expect(() => decodeKrpcValue('DOUBLE', Buffer.alloc(7))).toThrow(/double/);
    expect(() => decodeKrpcValue('BOOL', Buffer.from([0x80]))).toThrow(/scalar varint/);
    expect(() => decodeKrpcValue('UINT32', Buffer.from([0x01, 0x00]))).toThrow(/scalar varint/);
  });
});
