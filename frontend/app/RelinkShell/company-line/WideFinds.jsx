// WideFinds — what too-wide searches brought in, and the one press that passes it over (Design note, 2026-11-21: […]). Shown over DISCOVER and
// FILTER while any such company still waits to be filtered. Passing is not deleting: each stands under PASSED with
// why, and can be kept again. New searches this wide keep nothing (backend sales/wide-search.js).
const n = (v) => Number(v || 0).toLocaleString('en-US');

/** @param {{wide: ?{searches: number, companies: number, left: number, limit: number}, busy: boolean, onPass: () => void}} props */
export const WideFinds = ({ wide, busy, onPass }) => {
  if (!wide?.left) return null;
  return (
    <div className="spl-wide" role="status" data-wide-finds={wide.left}>
      <p className="spl-wide-t">
        <b>{n(wide.left)}</b> of the companies waiting in FILTER came from {n(wide.searches)} search{wide.searches === 1 ? '' : 'es'} too wide to be their audience&apos;s:
        each matched more than {n(wide.limit)} companies, and what a database returns first then is whoever holds the most addresses, not who fits.
      </p>
      <button type="button" className="sec-scan label-data" disabled={busy} data-wide-pass="" onClick={onPass}>PASS THEM OVER</button>
      <p className="spl-note label-data">THEY MOVE TO PASSED, WITH WHY, AND ANY ONE CAN BE KEPT AGAIN. A SEARCH THIS WIDE NOW KEEPS NOTHING.</p>
    </div>
  );
};
