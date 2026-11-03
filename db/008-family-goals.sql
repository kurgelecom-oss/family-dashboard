-- Family goals (3 Nov 2026): the one master list behind the goal bar, the home "Our goals" card,
-- /sunday and the weekly story. Seeded from tk's goal sheet artifact. Open goals are ranked;
-- a goal that falls due is settled done/missed with the family PIN and stays here as history.
create table if not exists fds_goals (
 id uuid primary key default gen_random_uuid(),
 workspace text not null,
 rank int not null,
 goal text not null check (length(goal) between 1 and 200),
 short text not null check (length(short) between 1 and 40),
 range text not null check (range in ('wk','1m','3m','6m','12m')),
 priority int check (priority between 1 and 4),
 how text not null default '' check (length(how) <= 500),
 metric text not null default 'none' check (metric in ('none','income_wk','omega_wk','tests_wk','net','proof','date')),
 target numeric,
 due date,
 status text not null default 'open' check (status in ('open','done','missed')),
 settled_at timestamptz,
 updated_at timestamptz not null default now()
);
create index if not exists fds_goals_open on fds_goals (workspace, status, rank);
alter table fds_goals enable row level security;
revoke all on fds_goals from anon,authenticated;
