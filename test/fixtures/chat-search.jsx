import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatSearch } from '../../frontend/app/RelinkShell/ChatSearch.jsx';
import { useChatSearch } from '../../frontend/app/RelinkShell/use-chat-search.js';
import { useChatSessions } from '../../frontend/app/RelinkShell/use-chat-sessions.js';

const labels = { 'search-one:session-100': 'Weekend ideas', 'search-one:session-200': 'Food plans' };
const Fixture = () => {
  const [lane, setLane] = useState('search-one');
  const { sessions, refresh, error } = useChatSessions(lane);
  useEffect(() => { refresh(); }, [refresh]);
  const search = useChatSearch(lane, sessions, labels);
  return <main>
    <button onClick={() => setLane('search-one')}>First participant</button>
    <button onClick={() => setLane('search-two')}>Second participant</button>
    {error ? <p role="alert">{error}</p> : null}
    <ChatSearch search={search} />
    <ul>{search.rows.map((row) => <li key={row.id} data-session={row.id}>
      <span>{row.label}</span>{row.excerpt ? <span className="chat-content-excerpt">{row.excerpt}</span> : null}
    </li>)}</ul>
  </main>;
};
createRoot(document.getElementById('root')).render(<Fixture />);
