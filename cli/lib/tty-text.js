export const ttyText = (value) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
