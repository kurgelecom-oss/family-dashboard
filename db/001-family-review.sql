-- Family-only tables in the existing shared OS database. Existing source tables are read-only.
create table if not exists fds_cycle_state (
 workspace text primary key, active boolean not null, started_on date, ended_on date,
 version integer not null default 1, updated_at timestamptz not null default now()
);
create table if not exists fds_cycle_history (
 workspace text not null, started_on date not null, ended_on date,
 primary key(workspace, started_on)
);
create table if not exists fds_weekly_manual (
 workspace text not null, week_start date not null, member text not null,
 metric text not null, value numeric, note text not null default '',
 version integer not null default 1, updated_at timestamptz not null default now(),
 primary key(workspace,week_start,member,metric),
 check (member in ('taylan','nihal','ansar','ayah')),
 check (value is null or value >= 0), check (extract(isodow from week_start)=1)
);
alter table fds_cycle_state enable row level security;
alter table fds_cycle_history enable row level security;
alter table fds_weekly_manual enable row level security;
revoke all on fds_cycle_state, fds_cycle_history, fds_weekly_manual from anon, authenticated;

alter table fds_weekly_manual add column if not exists mode text not null default 'supplement' check (mode in ('supplement','fallback'));
