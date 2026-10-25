-- Home Prayer Board: who leads Fajr/Maghrib/Isha each weekday and which two suras.
-- One row per workspace holding the whole board (the editor saves it whole).
-- Moved here from the claude.ai artifact on 25 Oct 2026 so the dashboard can read it.
create table if not exists fds_prayer_board (
 workspace text primary key,
 doc jsonb not null,
 updated_at timestamptz not null default now()
);
alter table fds_prayer_board enable row level security;
revoke all on fds_prayer_board from anon,authenticated;
