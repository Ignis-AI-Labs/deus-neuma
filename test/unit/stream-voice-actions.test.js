import { expect, test } from 'vitest';
import { streamVoiceAction } from '../../frontend/app/RelinkShell/stream-voice-actions.js';
import { reducer, initialState } from '../../frontend/app/RelinkShell/stream-reducer.js';

test.each(['voice:speech_started', 'voice:speech_stopped', 'voice:partial', 'voice:utterance'])(
'%s rejects pre-interrupt generations and never moves accepted generations backwards', (channel) => {
  const state = Object.freeze({ generation: 8, floor: 5 });
  expect(streamVoiceAction(channel, { gen: 4, text: 'old' }, state)).toBeNull();
  expect(streamVoiceAction(channel, { gen: 5 }, state).generation).toBe(8);
  expect(streamVoiceAction(channel, { gen: 9 }, state).generation).toBe(9);
  expect(streamVoiceAction(channel, {}, state).generation).toBe(8);
  expect(state).toEqual({ generation: 8, floor: 5 });
});

test('a new microphone session resets both generation values, including absent generation', () => {
  expect(streamVoiceAction('voice:mic_open', { gen: 2 }, { generation: 8, floor: 8 })).toEqual({ generation: 2, floor: 2 });
  for (const gen of [undefined, '2', 1.5]) {
    expect(streamVoiceAction('voice:mic_open', { gen })).toEqual({ generation: 0, floor: 0 });
  }
});

test('audio from the interrupted turn stays rejected while subsequent and untagged audio survive', () => {
  expect(streamVoiceAction('voice:audio', { turnId: 'cut' }, { cutTurn: 'cut' })).toBeNull();
  expect(streamVoiceAction('voice:audio', { turnId: 'next' }, { cutTurn: 'cut' })).toEqual({ turnId: 'next' });
  expect(streamVoiceAction('voice:audio', { turnId: 2 }, { cutTurn: 'cut' })).toEqual({ turnId: null });
});

test('real reducer replaces partial transcripts and retires them before the final thought is sent', () => {
  const context = { generation: 3, floor: 3 };
  const first = streamVoiceAction('voice:partial', Object.freeze({ gen: 3, text: 'One' }), context);
  const second = streamVoiceAction('voice:partial', { gen: 3, text: 'One sentence' }, context);
  let state = reducer(reducer(initialState, first.action), second.action);
  expect(state.messages.filter((message) => message.voicePartial)).toHaveLength(1);
  expect(state.messages.at(-1).segments[0].text).toBe('One sentence');
  const final = streamVoiceAction('voice:utterance', { gen: 3, text: ' One sentence. ' }, context);
  expect(final.heard).toBe(' One sentence. ');
  expect(final.thought).toBe('One sentence.');
  state = reducer(state, final.action);
  expect(state.messages.filter((message) => message.voicePartial)).toHaveLength(0);
  expect(state.messages).toHaveLength(0);
});

test('blank or non-string final text retires a partial without scheduling an empty thought', () => {
  for (const text of ['  ', null, 42]) {
    const frame = streamVoiceAction('voice:utterance', { text }, { generation: 0, floor: 0 });
    expect(frame.thought).toBe('');
    expect(frame.action.type).toBe('VOICE_UTTERANCE');
  }
});

test('error translation retires the real partial and displays the text fallback', () => {
  const partial = streamVoiceAction('voice:partial', { text: 'unfinished' }, { generation: 0, floor: 0 });
  const error = streamVoiceAction('voice:error', { code: 'stt_unavailable' });
  const state = reducer(reducer(initialState, partial.action), error.action);
  expect(state.messages.some((message) => message.voicePartial)).toBe(false);
  expect(state.messages.at(-1).segments[0].text).toContain('continues as text');
  expect(streamVoiceAction('voice:error', { code: 7 }).action.code).toBe('');
  expect(streamVoiceAction('unknown', {})).toBeNull();
});
