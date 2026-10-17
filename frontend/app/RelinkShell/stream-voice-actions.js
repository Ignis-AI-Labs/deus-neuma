import { advanceVoiceGen, isStaleVoiceGen } from './stream-reducer.js';

/** Pure voice-frame decision; the host owns refs, playback, logging and sending. */
export const streamVoiceAction = (channel, data, { generation, floor, cutTurn } = {}) => {
  if (channel === 'voice:audio') {
    const turnId = typeof data?.turnId === 'string' ? data.turnId : null;
    return turnId && turnId === cutTurn ? null : { turnId };
  }
  if (channel === 'voice:mic_open') {
    const gen = Number.isInteger(data?.gen) ? data.gen : 0;
    return { generation: gen, floor: gen };
  }
  if (channel === 'voice:error') {
    return { action: { type: 'VOICE_NOTE', code: typeof data?.code === 'string' ? data.code : '' } };
  }
  if (!['voice:speech_started', 'voice:speech_stopped', 'voice:partial', 'voice:utterance'].includes(channel)) return null;
  if (isStaleVoiceGen(data?.gen, floor)) return null;
  const next = advanceVoiceGen(generation, data?.gen);
  if (channel === 'voice:partial') {
    return { generation: next, action: { type: 'VOICE_PARTIAL', text: data?.text }, heard: data?.text };
  }
  if (channel === 'voice:utterance') {
    return { generation: next, action: { type: 'VOICE_UTTERANCE' }, heard: data?.text,
      thought: typeof data?.text === 'string' ? data.text.trim() : '' };
  }
  return { generation: next };
};
