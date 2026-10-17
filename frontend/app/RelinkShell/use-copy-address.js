// useCopyAddress — click-to-copy with a transient "copied" flag; clears its
// timer on unmount. Shared by every wallet surface that shows an address or a
// transaction hash (balance header, receive layer, receipt, witness settings).

import { useEffect, useState, useRef } from 'react';
import { uiSound } from '../../services/ui-sound.js';

export const useCopyAddress = (value) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    if (!value) return;
    uiSound('tick');
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch { setCopied(false); }
  };
  return { copied, copy };
};
