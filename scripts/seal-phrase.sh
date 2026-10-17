#!/usr/bin/env bash
# Seal a recovery passphrase as an encrypted file for phone cold storage.
#
#   bash scripts/seal-phrase.sh [output-path]
#
# RUN IN A PLAIN TERMINAL — never inside an AI session (no transcripts).
# You will enter:
#   1) the passphrase to seal — hidden input, never echoed, never logged
#   2) a WRAPPING secret at the gpg prompt — something you MEMORIZE,
#      and it must be DIFFERENT from the passphrase being sealed
#      (a file cannot be locked with the key stored inside it)
#
# Result: an AES-256 .gpg file. Send it to your phone, then shred the
# local copy. Recovery = copy file off phone to any machine with gpg,
# decrypt with the memorized wrapping secret.
set -euo pipefail

OUT="${1:-$HOME/neuma-recovery-$(date +%Y%m%d).gpg}"

read -rsp "Passphrase to seal (hidden): " P1; echo
read -rsp "Repeat: " P2; echo
[ "$P1" = "$P2" ] || { echo "Mismatch — nothing written."; exit 1; }

TMP="$(mktemp)"
trap 'shred -u "$TMP" 2>/dev/null || rm -f "$TMP"; unset P1 P2' EXIT
printf '%s\n' "$P1" > "$TMP"

# gpg prompts for the wrapping secret (the one you memorize)
gpg --symmetric --cipher-algo AES256 --output "$OUT" "$TMP"

echo
echo "Sealed: $OUT"
echo
echo "Send to phone:   kdeconnect-cli -l"
echo "                 kdeconnect-cli -d <device-id> --share '$OUT'"
echo "Verify it arrived on the phone, THEN remove the local copy:"
echo "                 shred -u '$OUT'"
