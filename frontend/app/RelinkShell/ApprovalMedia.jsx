import { useEffect, useMemo, useState } from 'react';
import { fetchIntentMediaUrl } from '../../services/social-channels-client.js';

/** Own the browser resources for one attachment set on a pending decision. */
export const ApprovalMedia = ({ lane, namesJson }) => {
  const names = useMemo(() => JSON.parse(namesJson), [namesJson]);
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const ownedUrls = new Set();
    Promise.all(names.map(async (name) => {
      try {
        const url = await fetchIntentMediaUrl(lane, name);
        if (cancelled) URL.revokeObjectURL(url);
        else ownedUrls.add(url);
        return { url };
      } catch {
        return { error: true };
      }
    })).then((next) => { if (!cancelled) setRows(next); });
    return () => {
      cancelled = true;
      for (const url of ownedUrls) URL.revokeObjectURL(url);
    };
  }, [lane, names]);

  const failedImage = (index) => setRows((current) => current.map(
    (row, at) => at === index ? { ...row, error: true } : row,
  ));
  return (
    <div className="approval-media">
      {names.map((name, index) => rows[index]?.error ? (
        <p key={`${index}:${name}`} role="status">Preview unavailable: {name}</p>
      ) : rows[index]?.url ? (
        <img key={`${index}:${name}`} src={rows[index].url}
          alt={`Attachment: ${name}`} onError={() => failedImage(index)} />
      ) : <p key={`${index}:${name}`} role="status">Loading preview: {name}</p>)}
    </div>
  );
};
