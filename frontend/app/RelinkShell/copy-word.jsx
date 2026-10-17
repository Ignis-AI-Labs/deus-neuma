// copy-word — the copy control on a message (Design note, 2026-07-23: […]).
// Copies the SPOKEN words only — chips (acts, approvals, asks) and images
// stay out of the clipboard; a reply pastes as prose, not as UI debris.
// The button confirms itself (COPIED) for a breath, then settles back.

import { useRef, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { speechText } from './copy-text.js';

export { speechText };

export const CopyWord = ({ text, className = '' }) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);
  if (!text) return null;
  return (
    <button
      type="button"
      className={`relink-copy label-data ${className}`.trim()}
      title="Copy these words"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          uiSound('tick');
          setCopied(true);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setCopied(false), 1200);
        } catch {
          uiSound('deny'); // clipboard refused — never a silent no-op
        }
      }}
    >
      {copied ? 'COPIED' : 'COPY'}
    </button>
  );
};
