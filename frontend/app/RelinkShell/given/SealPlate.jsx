// SealPlate — 01·D SEAL: the record of its birth. Its genesis hash drawn as
// the grid of its sixty-four digits (each cell one hex digit, its brightness
// its value — the fingerprint itself, not a picture of one); the road from
// its sealed instant to its anchor on chain; every fact explaining itself.

import { formatDateTime } from '../../../utils/format.js';
import { sealCellsOf, onchainCellsOf } from '../sheet-being-view.js';
import { PAGE_GUIDE, FIELD_GUIDE, leanValue } from './given-guide.js';
import { hashDigits, sealRoadOf } from './given-view.js';
import { GuidedPage, GuideGrid, useGuide } from './FieldGuide.jsx';

const G = FIELD_GUIDE.seal;
const fmt = (iso) => formatDateTime(iso).toUpperCase();

const HashGrid = ({ hash }) => {
  const digits = hashDigits(hash);
  if (digits.length !== 64) return null;
  return (
    <svg className="ski gv-hash" viewBox="0 0 168 168" role="img" aria-label="The genesis hash, digit by digit">
      {digits.map((d, i) => (
        <rect key={i} x={4 + (i % 8) * 20} y={4 + Math.floor(i / 8) * 20} width="16" height="16"
          className="gv-hash-cell" style={{ opacity: 0.08 + (d / 15) * 0.92 }} />
      ))}
    </svg>
  );
};

export const SealPlate = ({ file }) => {
  const [chosen, choose] = useGuide();
  if (file === null) return <p className="sheet-unreadable label-data">UNREADABLE</p>;
  const cells = sealCellsOf(file, fmt).map((c) => (c.k === 'LEAN' ? { ...c, v: leanValue(file.seal.lean) } : c));
  if (!cells.length) return <p className="sheet-line label-data">NO GENESIS SEAL ON THIS LANE.</p>;
  const chain = onchainCellsOf(file, fmt);
  const road = sealRoadOf(file);
  // LEAN's guide reads the sealed number itself, not the label shown
  const guideOf = (k) => (k === 'LEAN' ? { ...G.LEAN, reading: () => G.LEAN.reading(file.seal.lean) } : G[k] || null);
  const guided = (list) => list.map((c) => ({ ...c, guide: guideOf(c.k) }));
  const leanReading = G.LEAN.reading(file.seal.lean);
  return (
    <GuidedPage page={PAGE_GUIDE.seal} chosen={chosen} onChoose={choose}
      reading={road ? `Sealed ${fmt(road.born)}${road.anchored ? `; anchored on chain ${road.after} later` : '; not yet anchored on chain'}.${leanReading ? ` Its lean: ${leanReading}` : ''}` : null}>
      <div className="gv-seal">
        <figure className="gv-figure gv-hash-fig">
          <HashGrid hash={file.seal.genesisHash} />
          <button type="button" className={`gv-caption label-data${chosen?.id === 'GENESIS HASH' ? ' is-on' : ''}`} onClick={() => choose({ id: 'GENESIS HASH', value: file.seal.genesisHash, ...G['GENESIS HASH'] })}>
            ITS GENESIS HASH · 64 HEX DIGITS · EACH CELL ONE DIGIT, ITS BRIGHTNESS ITS VALUE
          </button>
        </figure>
        {road ? (
          <ol className="gv-road" aria-label="From its birth to its anchor on chain">
            <li className="gv-road-stop is-done"><span className="label-data">BORN · SEALED</span><span className="gv-road-at">{fmt(road.born)}</span></li>
            <li className={`gv-road-stop${road.anchored ? ' is-done' : ''}`}>
              <span className="label-data">ANCHORED ON CHAIN</span>
              <span className="gv-road-at">{road.anchored ? fmt(road.anchored) : 'NOT YET'}</span>
              {road.after ? <span className="gv-road-after label-data">{road.after} AFTER ITS BIRTH</span> : null}
            </li>
          </ol>
        ) : null}
      </div>
      <GuideGrid chosen={chosen} onChoose={choose} cells={guided(cells)} />
      <p className="sb-sub label-data">ON CHAIN</p>
      {chain ? <GuideGrid chosen={chosen} onChoose={choose} cells={guided(chain)} /> : <p className="sheet-line label-data">NOT YET ANCHORED ON CHAIN.</p>}
    </GuidedPage>
  );
};
