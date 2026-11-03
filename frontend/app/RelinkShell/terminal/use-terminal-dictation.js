// Terminal dictation: a live preview while held, then ordinary editable PTY
// input. The transcript never includes Enter, so a command cannot run by voice.

import { useCallback, useState } from 'react';
import { usePushToTalk } from '../use-push-to-talk.js';

export const useTerminalDictation = (sendToShell) => {
  const [preview, setPreview] = useState('');
  const onTranscript = useCallback((text) => {
    setPreview('');
    if (text) sendToShell(text);
  }, [sendToShell]);
  const onPreview = useCallback((text) => setPreview(text), []);
  const onFinalError = useCallback(() => setPreview(''), []);
  const { state, begin, end, setup, dismissSetup } = usePushToTalk(onTranscript, onPreview, onFinalError);
  return { state, preview, begin, end, setup, dismissSetup };
};
