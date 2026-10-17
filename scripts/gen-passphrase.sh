#!/usr/bin/env bash
# Diceware-style passphrase generator — sovereign backup grade.
#
#   bash scripts/gen-passphrase.sh [word-count]   (default 15, range 15-24)
#
# The minimum IS the quantum-secure floor: 15 words ≈ 256 raw bits ≈ 128
# Grover-adjusted bits. This tool cannot generate a weak phrase.
#
# Words are drawn from the system dictionary (filtered to common, typeable
# words) using /dev/urandom — cryptographically secure randomness. Entropy
# is printed so the strength is a measurement, not a vibe (SHINKEI) —
# including the post-quantum figure: Grover's algorithm halves effective
# symmetric strength, so the quantum-adjusted bits are entropy/2. Anything
# ≥128 post-quantum bits (≈15 words) exceeds what physics permits brute
# forcing; 24 words is for those who want the math beyond all argument.
#
# RUN THIS IN A PLAIN TERMINAL, not inside an AI session — the phrase
# must never appear in any transcript or log. Store it in your phone's
# password manager immediately; it is your recovery root.
set -euo pipefail

COUNT="${1:-15}"
if ! [[ "$COUNT" =~ ^[0-9]+$ ]] || [ "$COUNT" -lt 15 ] || [ "$COUNT" -gt 24 ]; then
  echo "word-count must be an integer 15-24 — 15 is the quantum-secure floor (got: $COUNT)"; exit 1
fi
WORDLIST=/usr/share/dict/words
WORK="$(mktemp)"
trap 'rm -f "$WORK"' EXIT

[ -r "$WORDLIST" ] || { echo "No system wordlist at $WORDLIST (dnf install words)"; exit 1; }

# Filter: lowercase ascii only, 4-8 letters — typeable, unambiguous
grep -E '^[a-z]{4,8}$' "$WORDLIST" | sort -u > "$WORK"
POOL="$(wc -l < "$WORK")"

PHRASE="$(shuf --random-source=/dev/urandom -n "$COUNT" "$WORK" | paste -sd '-')"

# Entropy: count * log2(pool size); post-quantum = Grover-halved
BITS="$(python3 -c "import math; print(round($COUNT * math.log2($POOL)))")"
PQ_BITS=$((BITS / 2))

echo
echo "  $PHRASE"
echo
echo "  words: $COUNT · pool: $POOL · entropy: ~$BITS bits"
echo "  post-quantum (Grover-adjusted): ~$PQ_BITS bits $([ "$PQ_BITS" -ge 128 ] && echo '— beyond physical brute force, classical or quantum')"
echo
echo "Store it in your password manager NOW, then clear this terminal"
echo "(Ctrl+L, or close the window)."
