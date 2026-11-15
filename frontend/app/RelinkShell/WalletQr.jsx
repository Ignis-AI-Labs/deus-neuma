// WalletQr — an address as a scannable code, drawn on this computer (the
// qrcode package; nothing is fetched). Dark modules on a light field so any
// phone camera reads it; the field is small, so it is no flash.

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** @param {{value: string, size?: number, label: string}} props */
export const WalletQr = ({ value, size = 128, label }) => {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, color: { dark: '#0b0e11', light: '#e4eaf0' } })
      .then((url) => { if (live) setSrc(url); })
      .catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [value, size]);
  return src ? <img className="wal-qr" src={src} width={size} height={size} alt={label} /> : null;
};
