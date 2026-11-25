// Dictation in every app, its pure parts: the kernel's keyboard list (read from this machine's real
// /proc/bus/input/devices where there is one) and event records, the hold machine, the WAV wrap.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOLD_KEYS, parseKeyboards, parseKeyEvents } from '../../backend/services/system-dictation/input-events.js';
import { HOLD_MS, IDLE, holdStep } from '../../backend/services/system-dictation/hold-machine.js';
import { MIN_SPEECH_BYTES, RECORDERS, pcmToWav } from '../../backend/services/system-dictation/audio.js';

const record = (type, code, value) => {
  const b = Buffer.alloc(24);
  b.writeUInt16LE(type, 16); b.writeUInt16LE(code, 18); b.writeInt32LE(value, 20);
  return b;
};

describe('the keyboard list', () => {
  const sample = [
    'I: Bus=0019\nN: Name="Power Button"\nH: Handlers=kbd event1 \nB: EV=3',
    'I: Bus=0003\nN: Name="Corsair K100 Keyboard"\nH: Handlers=sysrq kbd leds event19 \nB: EV=120013',
    'I: Bus=0006\nN: Name="ydotoold virtual device"\nH: Handlers=kbd event30 \nB: EV=120013',
    'I: Bus=0003\nN: Name="Corsair K100 Keyboard (ears)"\nH: Handlers=kbd event31 \nB: EV=120013',
    'I: Bus=0003\nN: Name="A Mouse"\nH: Handlers=mouse0 event4 \nB: EV=17',
  ].join('\n\n');
  it('keyboards that repeat keys, never power buttons or mice or ydotool\'s own device', () => {
    expect(parseKeyboards(sample)).toEqual([
      { name: 'Corsair K100 Keyboard', event: 'event19' },
      { name: 'Corsair K100 Keyboard (ears)', event: 'event31' },
    ]);
  });
  it.skipIf(!fs.existsSync('/proc/bus/input/devices'))('this machine\'s own list reads as keyboards with an event device each', () => {
    const found = parseKeyboards(fs.readFileSync('/proc/bus/input/devices', 'utf8'));
    for (const k of found) expect(k.event).toMatch(/^event\d+$/);
  });
});

describe('the event stream', () => {
  it('reads key records, skips the rest, and carries a split record to the next chunk', () => {
    const stream = Buffer.concat([record(4, 4, 70), record(1, HOLD_KEYS.rightctrl.code, 1), record(0, 0, 0), record(1, 97, 0)]);
    const first = parseKeyEvents(stream.subarray(0, 50));
    expect(first.keys).toEqual([{ code: 97, value: 1 }]);
    const rest = parseKeyEvents(stream.subarray(50), first.carry);
    expect(rest.keys).toEqual([{ code: 97, value: 0 }]);
    expect(rest.carry.length).toBe(0);
  });
});

describe('the hold', () => {
  const run = (events) => events.reduce(({ state, actions }, e) => {
    const step = holdStep(state, e);
    return { state: step.state, actions: [...actions, step.action] };
  }, { state: IDLE, actions: [] });
  it('held past the threshold it records, and the release reads it', () => {
    expect(run([{ type: 'down', at: 0 }, { type: 'timer', at: HOLD_MS }, { type: 'down', at: 300 }, { type: 'up', at: 2000 }]).actions)
      .toEqual(['arm', 'start', null, 'stop']);
  });
  it('a tap records nothing, and a late timer after it does nothing', () => {
    expect(run([{ type: 'down', at: 0 }, { type: 'up', at: 100 }, { type: 'timer', at: HOLD_MS }]).actions).toEqual(['arm', null, null]);
  });
});

describe('the microphone side', () => {
  it('asks every recorder for 16 kHz mono 16-bit raw', () => {
    expect(RECORDERS['pw-record']).toEqual(['--raw', '--rate', '16000', '--channels', '1', '--format', 's16', '-']);
    expect(Object.keys(RECORDERS)).toEqual(['pw-record', 'parecord', 'arecord']);
  });
  it('wraps raw samples as a standard WAV', () => {
    const wav = pcmToWav(Buffer.alloc(320));
    expect(wav.length).toBe(364);
    expect([wav.toString('ascii', 0, 4), wav.toString('ascii', 8, 12), wav.toString('ascii', 36, 40)]).toEqual(['RIFF', 'WAVE', 'data']);
    expect([wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt16LE(34), wav.readUInt32LE(40)]).toEqual([1, 16000, 16, 320]);
    expect(MIN_SPEECH_BYTES).toBe(9600);
  });
});
