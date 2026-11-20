import { useEffect, useState } from 'react';
import { deskTicketUrl } from '../../services/desk-tickets.js';

export const useDeskTicketUrl = (path, query = {}) => {
  const key = JSON.stringify(query);
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => deskTicketUrl(path, JSON.parse(key)).then((next) => { if (live) setUrl(next); }).catch(() => { if (live) setUrl(null); });
    load();
    const timer = setInterval(load, 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [path, key]);
  return url;
};
