#!/usr/bin/env bash
# Verify the mirrored ANSAR FC modules are identical across the two repos.
#
# Each file in MIRRORED below exists in both family-dashboard and
# ansar-habits-tracker. They are separate deploys reading the same Supabase
# `habit_completions` rows, so if the copies drift the same history reports
# different numbers depending on which screen you look at. That drift is what
# this script exists to catch.
#
#   app/lib/scoring.ts  - the same day scoring differently on each surface.
#   app/lib/streak.ts   - the same history reporting a different streak. Added
#                         after exactly that happened: the streak rule lived
#                         inline in three components, kept in agreement by a
#                         comment reading "same rule as the tracker", and the
#                         dashboard reported 8 where the tracker reported 14.
#
# Exits 0 when every pair is identical, non-zero otherwise. Run it before
# committing a change to any mirrored copy.
#
# The two repos are siblings by default. Override with:
#   FAMILY_DASHBOARD=/path/to/family-dashboard \
#   ANSAR_TRACKER=/path/to/ansar-habits-tracker \
#   ./scripts/check-scoring-sync.sh

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
parent="$(dirname "$here")"

FAMILY_DASHBOARD="${FAMILY_DASHBOARD:-$parent/family-dashboard}"
ANSAR_TRACKER="${ANSAR_TRACKER:-$parent/ansar-habits-tracker}"

# Repo-relative paths that must be byte-for-byte identical in both checkouts.
MIRRORED=(
  "app/lib/scoring.ts"
  "app/lib/streak.ts"
)

missing=0
for rel in "${MIRRORED[@]}"; do
  for f in "$FAMILY_DASHBOARD/$rel" "$ANSAR_TRACKER/$rel"; do
    if [ ! -f "$f" ]; then
      echo "MISSING: $f"
      missing=1
    fi
  done
done
if [ "$missing" -ne 0 ]; then
  echo
  echo "RESULT: FAIL - a mirrored copy is missing."
  exit 2
fi

drifted=0
for rel in "${MIRRORED[@]}"; do
  a="$FAMILY_DASHBOARD/$rel"
  b="$ANSAR_TRACKER/$rel"

  sha_a="$(shasum -a 256 "$a" | awk '{print $1}')"
  sha_b="$(shasum -a 256 "$b" | awk '{print $1}')"

  echo "$rel"
  echo "  family-dashboard      $sha_a"
  echo "  ansar-habits-tracker  $sha_b"

  if [ "$sha_a" = "$sha_b" ]; then
    echo "  ok"
  else
    echo "  OUT OF SYNC"
    echo
    echo "  diff (family-dashboard -> ansar-habits-tracker):"
    diff -u "$a" "$b" || true
    drifted=1
  fi
  echo
done

if [ "$drifted" -eq 0 ]; then
  echo "RESULT: IN SYNC"
  exit 0
fi

echo "RESULT: OUT OF SYNC - a mirrored copy differs."
exit 1
