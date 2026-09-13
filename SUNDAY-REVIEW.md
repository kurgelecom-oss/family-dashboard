# Family Sunday review

13 September 2026. The owner approved shipping all three designs as live options.

The home route defaults to Weekly review on Sundays in Australia/Melbourne, and Daily dashboard on other days. A manual view choice survives refresh for the rest of that local day, then expires. “Restore Sunday schedule” clears it. `/sunday` opens the current report on any day. Gather, Scorecard and Mosaic use identical data; the design selection is saved on this device.

The period switch is explicit persisted on/off state. No elapsed-day rule turns it off. Both Family OS and Nihal OS use Family `/api/cycle`; Nihal proxies authenticated changes. History is retained; the recorded state takes precedence over Nihal's estimated curve. The household PIN protects editing and is remembered on the device. PIN, signing secret and service connection token are server-only environment variables.

## Source map

- Quran OS `/api/snapshot`: dated finished sessions for Taylan, Nihal, Ansar, Ayah. Days counted distinctly; sessions, minutes, new ayahs and pages summed only within Monday–Sunday and through today.
- Product Validation Notion database: Submission Date and Validated On. Validation totals are shared pipeline reviews, including both passes and kills. Older rows do not identify the finder.
- Creative OS `cos_radar_products`: only dated manual intake attributed to Nihal; automated nightly discovery is excluded. Products are deduplicated by name against attributed Notion rows.
- Origins: Done training rows, Completed On, Completed By. If Completed By is absent, a module assigned exclusively to Nihal is used. Shared modules without ownership and Action Items are excluded.
- Product Test Engine: first immutable transition to Live per product. Only already-Live products can use legacy launch_date fallback. Setup dates, relaunches and verification artifacts are excluded.
- Homeschool master log: dated Ansar work submissions, excluding seed rows; brief work/day/learning-area totals.
- Ansar habit completions: canonical weekday scoring from unchanged `scoring.ts`, out of 55 with the perfect-week bonus. Weekend stretch points excluded.
- custm Meta account: read-only account insights for the exact report dates, AUD spend and aggregate lead actions once. Leads are enquiries, not confirmed customer wins. No budgets, campaigns or ads are modified.
- Manual entries: back-to-sleep mornings for Taylan/Nihal/Ansar; unlogged discoveries, mentorship, validations and launches; weekly notes; backups for unavailable metrics. Blank is unknown, zero is explicitly entered.

Manual extras are distinct from fallback totals. A recovered connection never adds the fallback total again; supplemental entries cannot imply a complete total when the connected portion is unknown. Draft week, mode and version are pinned on opening, and conflicting writes return 409.

## Storage and deployment

`db/001-family-review.sql` creates three private `fds_` tables in the existing shared Quran/Creative database, leaving existing source tables unchanged. `FAMILY_WORKSPACE` separates preview and production rows. The old `cycle_starts` data is copied into cycle history; the current on/off state is copied once during migration, never recalculated from duration.

Server variables: FAMILY_DATABASE_URL, FAMILY_WORKSPACE, QURAN_OS_TOKEN, FAMILY_META_TOKEN, FAMILY_EDIT_PIN, FAMILY_SESSION_SECRET, FAMILY_EDIT_KEY, NOTION_TOKEN. Nihal OS needs FAMILY_CYCLE_BASE_URL (Family URL) and FAMILY_EDIT_KEY in addition to its existing auth settings.

Preview initialization: `node --env-file=.env.local scripts/prepare-sunday-preview.mjs`. This refuses the production workspace. Production initialization: `node --env-file=.env.local scripts/prepare-family-production.mjs --initialise-production`. It copies a fresh live snapshot before the cycle endpoint changes and never overwrites an existing production state. No test records are copied to production.

## Verification

- 17 Family unit tests; 43 Nihal tests; both TypeScript checks passed before deployment.
- Browser measurements: all three themes at 1905×923, 1920×936, 1920×1080 and 390×844. Desktop footers fit; card content has at least 28px bottom room; mobile scrolling works without horizontal overflow.
- Browser writes: household unlock, save/reload, stale entry 409, stale cycle 409, Family-off → Nihal sees off → Nihal-on → Family sees on.
- Browser calendar: Sunday default weekly; Sunday manual daily persists; Monday discards Sunday's override; weekday manual weekly works.
- Preview test entries removed and copied cycle state restored after tests.

Production verification and deployment IDs are appended after live checks.
