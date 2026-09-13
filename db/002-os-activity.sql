-- Authenticated Nihal OS visits. No browser identifiers are exposed in reports.
create table if not exists fds_os_tracking (
 workspace text not null, member text not null check(member='nihal'),
 started_on date not null default (now() at time zone 'Australia/Melbourne')::date,
 primary key(workspace,member)
);
create table if not exists fds_os_sessions (
 id bigint generated always as identity primary key,
 workspace text not null, member text not null check(member='nihal'),
 browser_id text not null check(browser_id ~ '^[a-f0-9]{64}$'),
 day date not null, opened_at timestamptz not null, last_seen timestamptz not null
);
create index if not exists fds_os_sessions_browser on fds_os_sessions(workspace,member,browser_id,last_seen desc);
create index if not exists fds_os_sessions_day on fds_os_sessions(workspace,member,day);
alter table fds_os_tracking enable row level security;
alter table fds_os_sessions enable row level security;
revoke all on fds_os_tracking,fds_os_sessions from anon,authenticated;
