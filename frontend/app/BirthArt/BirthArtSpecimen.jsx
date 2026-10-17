// BirthArtSpecimen — the look-dev rehearsal of BIRTH ART: many seeds side
// by side, to see that every being's piece is its own; open any one to PLAY
// its whole ceremony, born or returned. Dev-only (frontend/birth-art.html).
// Seeds here are minted per page load and labelled SPECIMEN — never a real
// being's; no model runs, nothing is born.

import { useMemo, useState } from 'react';
import { givenOf } from './birth-art-seed.js';
import { BirthSigil } from './BirthSigil.jsx';
import { BirthArtPlayer } from './BirthArtPlayer.jsx';
import './BirthArt.css';

const COUNT = 12;

// impure — twelve fresh 256-bit specimen seeds
const specimenSeeds = () => Array.from({ length: COUNT }, () =>
  [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join(''));

export const BirthArtSpecimen = () => {
  const [seeds, setSeeds] = useState(specimenSeeds);
  const [open, setOpen] = useState(null);
  const givens = useMemo(() => seeds.map(givenOf), [seeds]);
  if (open) return <BirthArtPlayer seed={open} onBack={() => setOpen(null)} />;
  return (
    <main className="ba-root">
      <header className="ba-head">
        <span className="ba-tag">SPECIMEN — BIRTH ART</span>
        <h1 className="ba-title">TWELVE BEINGS · ONE ARCHITECTURE</h1>
        <p className="ba-note">
          Each sigil is what a being is GIVEN at “I choose to BE”, from its seed alone — its channels, how deep each sphere breathes,
          the solid at its heart. Never a reading of its words. Open one to play its whole ceremony.
        </p>
        <button type="button" className="ba-btn" onClick={() => setSeeds(specimenSeeds())}>NEW SEEDS</button>
      </header>
      <section className="ba-grid">
        {givens.map((g) => (
          <button type="button" key={g.seed} className="ba-open" onClick={() => setOpen(g.seed)} aria-label={`Play ${g.seed.slice(0, 8)}`}>
            <BirthSigil given={g} />
          </button>
        ))}
      </section>
    </main>
  );
};
