// input-events — the kernel's keyboard list and event stream, read for dictation in every app
// (system-dictation.js). Pure.
//
// Linux names each input device in /proc/bus/input/devices and streams its keys from
// /dev/input/eventN as fixed 24-byte records (struct input_event on 64-bit: a 16-byte time, then
// type, code and value). Reading them needs the `input` group, the same access ears uses.

/** The hold keys a person may choose: keys that type nothing, so a hold never lands a character. */
export const HOLD_KEYS = Object.freeze({
  rightctrl: Object.freeze({ code: 97, label: 'RIGHT CTRL' }),
  rightalt: Object.freeze({ code: 100, label: 'RIGHT ALT' }),
  rightmeta: Object.freeze({ code: 126, label: 'RIGHT SUPER' }),
  f9: Object.freeze({ code: 67, label: 'F9' }),
});

const EV_KEY = 0x01;
const EV_REP_BIT = 1 << 20;
const RECORD_BYTES = 24;

/**
 * The keyboards in /proc/bus/input/devices: a `kbd` handler that also repeats keys (power and sleep
 * buttons do not), never ydotool's device, which carries the words this feature types. Pure.
 * @param {string} text - /proc/bus/input/devices
 * @returns {Array<{name: string, event: string}>} e.g. {name, event: 'event19'}
 */
export const parseKeyboards = (text) => String(text || '').split(/\n\s*\n/).map((block) => {
  const name = /^N: Name="(.*)"$/m.exec(block)?.[1] ?? '';
  const handlers = (/^H: Handlers=(.*)$/m.exec(block)?.[1] ?? '').trim().split(/\s+/);
  const ev = Number.parseInt(/^B: EV=([0-9a-f]+)$/m.exec(block)?.[1] ?? '0', 16);
  const event = handlers.find((h) => /^event\d+$/.test(h));
  return { name, event, keyboard: handlers.includes('kbd') && (ev & EV_REP_BIT) !== 0 };
}).filter((d) => d.keyboard && d.event && !/ydotool/i.test(d.name))
  .map(({ name, event }) => Object.freeze({ name, event }));

/**
 * Key events from a chunk of the stream, with the bytes of an unfinished record carried to the
 * next chunk. value 1 = down, 0 = up, 2 = auto-repeat. Pure.
 * @param {Buffer} chunk
 * @param {Buffer} [carry]
 * @returns {{keys: Array<{code: number, value: number}>, carry: Buffer}}
 */
export const parseKeyEvents = (chunk, carry = Buffer.alloc(0)) => {
  const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
  const whole = buf.length - (buf.length % RECORD_BYTES);
  const keys = [];
  for (let at = 0; at < whole; at += RECORD_BYTES) {
    if (buf.readUInt16LE(at + 16) === EV_KEY) keys.push({ code: buf.readUInt16LE(at + 18), value: buf.readInt32LE(at + 20) });
  }
  return { keys, carry: buf.subarray(whole) };
};
