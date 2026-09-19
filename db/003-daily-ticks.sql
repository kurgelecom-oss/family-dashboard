-- Hand-ticked daily tasks on the family dashboard ("Today, together.").
-- One row = that task was done that Melbourne day. Unticking deletes the row.
-- Auto-ticked tasks (Quran OS, surface log, Origins, Nihal OS, pipeline) and
-- Ansar's habits are never stored here; they are read from their own sources.
create table if not exists fds_daily_ticks (
 workspace text not null,
 day date not null,
 task_id text not null check(task_id ~ '^[a-f0-9]{32}$'),
 member text not null check(member in ('taylan','nihal','ayah')),
 done_at timestamptz not null default now(),
 primary key(workspace,day,task_id)
);
alter table fds_daily_ticks enable row level security;
revoke all on fds_daily_ticks from anon,authenticated;
