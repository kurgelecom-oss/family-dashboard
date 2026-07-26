#!/usr/bin/env sh
#
# Remove iCloud/Finder duplicate files from the Next.js build output before a build.
#
# WHY THIS EXISTS
# ---------------
# This repo lives under ~/Documents, which macOS syncs to iCloud Drive. The sync
# occasionally duplicates files it finds mid-write, using Finder's naming convention:
# "routes.d.ts" becomes "routes.d 2.ts". `.next` is rewritten on every build and dev run,
# so it is the directory this keeps happening to.
#
# A duplicated *type declaration* is not inert. `.next/types/routes.d 2.ts` is still a
# .ts file inside the project, so `tsc` compiles it alongside the original and fails with
# duplicate-identifier errors — TS2300, TS2428, TS6200 — naming identifiers nobody wrote,
# in files nobody edited. It looks exactly like a broken type change. Observed twice in
# one session on 2026-07-26; deleting the duplicates restored exit 0 both times without
# touching a line of source.
#
# This script treats the symptom. The root cause is the repo's location, and moving it out
# of ~/Documents (or excluding it from iCloud) is the real fix — a separate job, recorded
# in BOARD-LEDGER.md Findings.
#
# SAFETY
# ------
# Only files *inside the build output directory* are considered, and `.next` is generated
# and gitignored, so anything deleted here is reproduced by the build that follows. Next
# emits hashed, space-free filenames, so the " <digit>." pattern cannot match a legitimate
# artefact. Nothing outside $DIR is read or written, and distDir is not changed: the
# directory is passed in (default `.next`) rather than configured.
#
# Usage: sh scripts/clean-icloud-dupes.sh [output-dir]
set -eu

DIR="${1:-.next}"
LABEL="[clean-icloud-dupes]"

if [ ! -d "$DIR" ]; then
  # First build on a clean checkout, or on CI. Not an error — there is simply nothing to
  # clean yet, and a build must never be blocked by that.
  echo "$LABEL $DIR does not exist yet — nothing to clean"
  exit 0
fi

# Matches "foo 2.js", "routes.d 2.ts", "package 3.json". The digit class covers the
# escalating duplicates macOS produces on repeat collisions; the instruction named
# "* 2.*" and this is a strict superset of it.
COUNT=$(find "$DIR" -type f -name "* [0-9].*" | wc -l | tr -d ' ')

if [ "$COUNT" -eq 0 ]; then
  echo "$LABEL no iCloud duplicates in $DIR"
  exit 0
fi

echo "$LABEL removing $COUNT iCloud duplicate file(s) from $DIR:"
find "$DIR" -type f -name "* [0-9].*" -print -delete | sed "s|^|$LABEL   |"
echo "$LABEL done"
