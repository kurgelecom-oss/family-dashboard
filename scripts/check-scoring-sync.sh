#!/usr/bin/env bash
# Verify the two mirrored copies of the ANSAR FC scoring module are identical.
#
# app/lib/scoring.ts exists in both family-dashboard and ansar-habits-tracker.
# They are separate deploys reading the same Supabase `habit_completions` rows,
# so if the copies drift the same day scores differently depending on which
# screen you look at. That drift is what this script exists to catch.
#
# Exits 0 when identical, non-zero otherwise. Run it before committing a change
# to either copy.
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

a="$FAMILY_DASHBOARD/app/lib/scoring.ts"
b="$ANSAR_TRACKER/app/lib/scoring.ts"

missing=0
for f in "$a" "$b"; do
  if [ ! -f "$f" ]; then
    echo "MISSING: $f"
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo
  echo "RESULT: FAIL - a mirrored copy is missing."
  exit 2
fi

sha_a="$(shasum -a 256 "$a" | awk '{print $1}')"
sha_b="$(shasum -a 256 "$b" | awk '{print $1}')"

echo "family-dashboard      $sha_a"
echo "ansar-habits-tracker  $sha_b"
echo

if [ "$sha_a" = "$sha_b" ]; then
  echo "RESULT: IN SYNC"
  exit 0
fi

echo "RESULT: OUT OF SYNC - the two copies differ."
echo
echo "diff (family-dashboard -> ansar-habits-tracker):"
diff -u "$a" "$b" || true
exit 1
