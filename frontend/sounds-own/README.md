# The platform's own sounds

These are sounds Founder designed himself, so they ship as-is (unlike `frontend/assets/sounds`, the licensed library, which never leaves this machine).

A manifest path that starts with `own/` is read from this folder by `scripts/bake-sounds.mjs` and baked into the sprite like every other cue.

| File | Cue | Made from |
|---|---|---|
| `thinking.wav` | `neumaThinking`, the loop while a being thinks | Founder's […] (2026-11-19), cleaned up |

## How thinking.wav was cleaned

The ambient wash and rumble were taken out; the blips and thumps were kept. Run on the original:

1. Rumble out: two 2-pole high-passes at 110 Hz.
2. The signal is split at 800 Hz (`acrossover`, 4th order), and each half gets its own gate:
   - Low half: opens at −24 dBFS peak. That keeps the thumps and drops the wash, which lives between −28 and −33 dBFS in that range.
   - High half: opens at −33 dBFS peak.
   - Both: ratio 20, attack 0.3 ms, release 50 ms, closed level −40 dB.
3. Edges: a 4 ms fade-in and a 30 ms fade-out, so the loop doesn't click.

Measured on the wash-only stretch (3.7–5.1 s), RMS fell from −37.6 to −63.0 dBFS. The blips (0–1.2 s) moved from −21.4 to −22.1.

The other versions are in `~/Music/Thinking FX - cleaned/`:
- B: tighter, with a shorter release and the low gate higher.
- C: lighter, where the wash is pushed down only 18 dB.
- D: version A with the near-silent middle pause cut.
