// ChatBatchItems.jsx — the two batch-naming items every chat list offers:
// TITLE UNTITLED names the chats with no title yet, RETITLE ALL names every
// chat again. One copy for the TITLE menu and for each row's right-click menu
// in the Chats window (one-on-ones and councils) and the stream's chat rail,
// so a person who finds the right-click first still finds the batch (#27).

/**
 * @param {{ itemClass: string, separatorClass?: string, titling: boolean,
 *   onRun: (opts: { force: boolean }) => void }} props
 *   `separatorClass` draws a rule above the items, parting them from a row's
 *   own items; `titling` disables them while a naming run is in flight.
 */
export const ChatBatchItems = ({ itemClass, separatorClass, titling, onRun }) => (
  <>
    {separatorClass ? <div className={separatorClass} role="separator" /> : null}
    <button type="button" className={itemClass} disabled={titling} onClick={() => onRun({ force: false })}>TITLE UNTITLED</button>
    <button type="button" className={itemClass} disabled={titling} onClick={() => onRun({ force: true })}>RETITLE ALL</button>
  </>
);
