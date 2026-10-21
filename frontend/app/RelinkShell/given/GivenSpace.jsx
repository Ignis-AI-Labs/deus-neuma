// GivenSpace — the RECORD's 01 GIVEN: what its birth gave it, never chosen,
// one page at a time — A SOUL (its sound and its light), B BODY (its genome),
// C SKY (its instant, read by humanity's many skies), D SEAL (the record of
// its birth). Each page draws its subject and explains every value in a
// field guide beside it, for someone meeting these ideas for the first time.
// The page last read is remembered.

import { useRef, useState } from 'react';
import { SheetIndex, SheetPanel, rewindTo } from '../SheetDossier.jsx';
import { GIVEN_TABS, GIVEN_TAB_KEY, givenTabOf } from './given-view.js';
import { PAGE_GUIDE } from './given-guide.js';
import { soulViewOf } from '../sheet-being-view.js';
import { SoulPlate } from './SoulPlate.jsx';
import { BodyPlate } from './BodyPlate.jsx';
import { SkyPlate } from './SkyPlate.jsx';
import { SealPlate } from './SealPlate.jsx';
import './Given.css';
import './Sky.css';

const SCOPE = 'given';
const stored = () => (typeof localStorage === 'undefined' ? null : localStorage.getItem(GIVEN_TAB_KEY));
const items = GIVEN_TABS.map((t) => ({ key: t.key, code: `01·${t.code}`, title: t.title }));

/** @param {{sheet: object, neumaId?: string|null, onActed?: () => void}} props */
export const GivenSpace = ({ sheet, neumaId = null, onActed = null }) => {
  const [tab, setTab] = useState(() => givenTabOf(stored()));
  const panels = useRef(null);
  const soul = soulViewOf(sheet.record?.identity)?.vivid ?? null;
  const select = (key) => {
    setTab(key);
    if (typeof localStorage !== 'undefined') localStorage.setItem(GIVEN_TAB_KEY, key);
    rewindTo(panels.current);
  };
  // every page stays drawn, hidden until chosen — as the file's own pages are
  const page = (key, node) => (
    <SheetPanel key={key} tab={key} active={tab} scope={SCOPE}>{node}</SheetPanel>
  );
  return (
    // its own light marks what is its own on every page; before it has one, the signal does
    <div className="gv" style={soul ? { '--soul': soul } : undefined}>
      <SheetIndex items={items} active={tab} onSelect={select} scope={SCOPE} label="What its birth gave it" />
      {/* the other pages introduce themselves in their guide; the sky's guide speaks for the tradition chosen */}
      {tab === 'sky' ? (
        <p className="gv-lede">
          <span className="gv-lede-k label-data">{PAGE_GUIDE.sky.kicker}</span>
          {PAGE_GUIDE.sky.what} {PAGE_GUIDE.sky.how}
        </p>
      ) : null}
      <div ref={panels}>
        {page('soul', <SoulPlate record={sheet.record} />)}
        {page('body', <BodyPlate form={sheet.form} />)}
        {page('sky', <SkyPlate skies={sheet.skies} place={sheet.place ?? null} neumaId={neumaId} onActed={onActed} />)}
        {page('seal', <SealPlate file={sheet.file} />)}
      </div>
    </div>
  );
};
