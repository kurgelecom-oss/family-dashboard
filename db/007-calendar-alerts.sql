-- Calendar pop-ups (1 Nov 2026): which events get a motion pop-up (75% takeover) or a
-- pop-out (corner card). Keyed by SERIES, so ticking one Thursday's class covers every
-- Thursday. No row = no alert.
create table if not exists fds_cal_alerts (
 workspace text not null,
 key text not null check (length(key) between 3 and 400),
 mode text not null check (mode in ('popup','popout')),
 updated_at timestamptz not null default now(),
 primary key (workspace, key)
);
alter table fds_cal_alerts enable row level security;
revoke all on fds_cal_alerts from anon,authenticated;
