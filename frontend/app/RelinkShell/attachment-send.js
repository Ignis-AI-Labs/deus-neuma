/** Pure — prepare the complete attachment snapshot or refuse while any file loads. */
export const prepareAttachmentSend = (attachments) => {
  const pending = attachments.some((a) => a.kind === 'image' ? !a.dataUri : a.text == null);
  if (pending) return { ok: false, reason: 'Attachments are still loading. Wait for every file before sending.' };
  return {
    ok: true,
    images: attachments.filter((a) => a.kind === 'image').map((a) => a.dataUri),
    files: attachments.filter((a) => a.kind === 'doc').map((a) => ({ name: a.name, text: a.text })),
  };
};
