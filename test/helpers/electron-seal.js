/* global Buffer */
import crypto from 'node:crypto';

// A real keychain-shaped AES-256-GCM seal; the key stays only in this closure.
export const aesSeal = () => {
  const key = crypto.randomBytes(32);
  return {
    available: true,
    strong: true,
    backend: () => 'gnome_libsecret',
    encrypt: (text) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ct]);
    },
    decrypt: (blob) => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
      decipher.setAuthTag(blob.subarray(12, 28));
      return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
};
