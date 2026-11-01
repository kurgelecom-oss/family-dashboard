-- Family calendar (/board, 1 Nov 2026): events made on the TV, and pen ink drawn over a view.
-- Outlook and Google events are read live and never stored here.
create table if not exists fds_cal_events (
 id uuid primary key default gen_random_uuid(),
 workspace text not null,
 cal text not null check (cal in ('family','taylan','nihal','ansar')),
 title text not null check (length(title) between 1 and 200),
 starts_at timestamptz not null,
 ends_at timestamptz not null check (ends_at >= starts_at),
 all_day boolean not null default false,
 notes text not null default '' check (length(notes) <= 2000),
 updated_at timestamptz not null default now()
);
create index if not exists fds_cal_events_range on fds_cal_events (workspace, starts_at);
alter table fds_cal_events enable row level security;
revoke all on fds_cal_events from anon,authenticated;

-- One row per view page ("week:2026-10-26", "day:2026-11-01", "month:2026-11", "year:2026").
create table if not exists fds_cal_ink (
 workspace text not null,
 scope text not null check (scope ~ '^(day|week|month|year):[0-9-]{4,10}$'),
 strokes jsonb not null default '[]',
 updated_at timestamptz not null default now(),
 primary key (workspace, scope)
);
alter table fds_cal_ink enable row level security;
revoke all on fds_cal_ink from anon,authenticated;
