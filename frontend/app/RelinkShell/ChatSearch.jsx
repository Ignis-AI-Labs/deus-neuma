import './ChatSearch.css';

/** Shared chat search control; matches remain ordinary navigable chat rows. */
export const ChatSearch = ({ search }) => (
  <div className="chat-content-search">
    <input className="label-data" type="search" value={search.query} maxLength={200}
      onChange={(event) => search.setQuery(event.target.value)}
      placeholder="Search titles and messages" aria-label="Search chat titles and messages" />
    {search.loading ? <p role="status">Searching messages…</p> : null}
    {search.error ? <p role="alert">{search.error} <button type="button" onClick={search.retry}>Retry search</button></p> : null}
  </div>
);
