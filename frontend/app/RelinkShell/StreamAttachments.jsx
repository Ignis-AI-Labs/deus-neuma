// StreamAttachments.jsx — shared images and documents: pasted or dropped,
// previewed as chips, uploaded on send (ids ride the portal frame; the
// bytes ride REST — WS frames cap at 64KB). Split from StreamInput.jsx
// (size law); bodies moved verbatim. The upload itself stays in the
// composer's submit path — this module owns admission and the chip row.

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { admitFiles, fileToDataUri, fileToText } from './attachments.js';
import { gateAttachments } from './composer-attach.js';
import { mediaMenuDoor } from './media-menu.js';
import { substrateSeesImages } from '../../services/attachments-client.js';

export const useStreamAttachments = ({ connected, neumaId }) => {
  const [attachments, setAttachments] = useState([]); // { key, dataUri, name }
  const [attachNote, setAttachNote] = useState(null); // one honest refusal line
  const [uploading, setUploading] = useState(false);
  // Whether the substrate THIS BEING rides can see — runtime truth, fetched
  // per link-up and per being (a switch of neuma can mean a switch of server).
  // null = unknowable (the portal will answer honestly instead).
  const [vision, setVision] = useState(null);
  useEffect(() => {
    if (!connected) return;
    let liveQuery = true;
    substrateSeesImages(neumaId).then((v) => { if (liveQuery) setVision(v); });
    return () => { liveQuery = false; };
  }, [connected, neumaId]);

  const attachKeyRef = useRef(0);
  // Mirror of the attachments state for event handlers — admission decisions
  // stay OUTSIDE the state updater (updaters must be pure; StrictMode runs
  // them twice, which would double every file read).
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const addFiles = useCallback(async (files) => {
    if (files.length === 0) return;
    const { accepted, refusal } = admitFiles(attachmentsRef.current, files);
    let sees = vision;
    // A latched "blind" is a MOMENT (this link came up while the substrate was
    // still igniting), never a life sentence — re-ask the serving before
    // refusing images. Founder's law 2026-08-15: a capability the model has is ON
    // by default; only the serving's live […] may refuse.
    if (sees === false && accepted.some((a) => a.kind === 'image')) {
      sees = await substrateSeesImages(neumaId);
      if (sees !== vision) setVision(sees);
    }
    const { admitted, note } = gateAttachments({ vision: sees, accepted, refusal });
    setAttachNote(note);
    if (admitted.length === 0) return;
    // Placeholders keep paste order; each chip fills in as its file resolves
    // (image → data URI, document → text), and a failed read removes itself
    // out loud.
    const entries = admitted.map(({ file, kind }) => ({
      key: `a${attachKeyRef.current++}`, kind, name: file.name || (kind === 'image' ? 'image' : 'document'),
      dataUri: null, text: null,
    }));
    setAttachments((cur) => [...cur, ...entries]);
    admitted.forEach(({ file, kind }, i) => {
      const { key } = entries[i];
      const fill = (patch) => setAttachments((cur) => cur.map((a) => (a.key === key ? { ...a, ...patch } : a)));
      const fail = (why) => { setAttachments((cur) => cur.filter((a) => a.key !== key)); setAttachNote(why); };
      if (kind === 'image') {
        fileToDataUri(file).then((dataUri) => fill({ dataUri }), () => fail('An image could not be read.'));
      } else {
        fileToText(file).then((text) => fill({ text }), (err) => fail(err?.message || 'A document could not be read.'));
      }
    });
  }, [vision, neumaId]);

  const removeAttachment = (key) => {
    setAttachments((cur) => cur.filter((a) => a.key !== key));
  };

  return {
    attachments, setAttachments, attachNote, setAttachNote,
    uploading, setUploading, vision, addFiles, removeAttachment,
  };
};

const AttachmentRowView = ({ attachments, attachNote, removeAttachment }) => (
  attachments.length > 0 || attachNote ? (
    <div className="relink-attach-row">
      {attachments.map((a) => {
        const loaded = a.kind === 'image' ? Boolean(a.dataUri) : a.text != null;
        return (
          <span key={a.key} className={`relink-attach-chip${a.kind === 'doc' ? ' is-doc' : ''}${loaded ? '' : ' is-reading'}`}>
            {a.kind === 'image'
              ? (a.dataUri
                  ? <img className="relink-attach-thumb" src={a.dataUri} alt={a.name} tabIndex={0}
                      {...mediaMenuDoor({ kind: 'image', src: a.dataUri, name: a.name, alt: a.name })} />
                  : <span className="relink-attach-thumb" aria-label="reading image" />)
              : <span className="relink-attach-doc" title={a.name}>{a.name}</span>}
            <button
              type="button"
              className="relink-attach-remove"
              aria-label={`Remove ${a.name}`}
              title={`Remove ${a.name}`}
              onClick={() => removeAttachment(a.key)}
            >
              ×
            </button>
          </span>
        );
      })}
      {attachNote ? <span className="relink-attach-note" role="status">{attachNote}</span> : null}
    </div>
  ) : null
);

// Memoized: the composer re-renders on every keystroke; this does not need to
// (2026-09-28 smoothness pass).
export const AttachmentRow = memo(AttachmentRowView);
