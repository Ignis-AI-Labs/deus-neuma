export const HELD_ACK_CHANNELS = Object.freeze([
  'consciousness:queued', 'consciousness:queue_taken',
  'consciousness:queue_edited', 'consciousness:queue_pulled',
]);

/** Pure queue acknowledgement translation; counts precede actions in the host. */
export const heldAckAction = (channel, data) => {
  if (!HELD_ACK_CHANNELS.includes(channel)) return null;
  const count = Number(data?.held) || 0;
  const holdId = data?.holdId;
  let action = null;
  if (holdId) {
    switch (channel) {
      case 'consciousness:queued': action = { type: 'QUEUE_MARK', holdId }; break;
      // heard: the words joined the reply in flight — they are set into it where they were picked up.
      case 'consciousness:queue_taken': action = data.heard ? { type: 'QUEUE_HEARD', holdId, text: typeof data.thought === 'string' ? data.thought : '', at: data.at ?? null } : { type: 'QUEUE_CLEAR', holdId }; break;
      case 'consciousness:queue_edited':
        if (data.ok && typeof data.thought === 'string') action = { type: 'QUEUE_EDIT', holdId, text: data.thought };
        else if (!data.ok) action = { type: 'QUEUE_CLEAR', holdId };
        break;
      case 'consciousness:queue_pulled':
        action = { type: 'QUEUE_PULLED', holdId, text: typeof data.thought === 'string' ? data.thought : '' };
        break;
    }
  }
  return { count, action };
};
