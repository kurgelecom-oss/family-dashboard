-- Weekly family story: who opened their personal story link, and which weekly emails went out.
create table if not exists fds_story_views (
 workspace text not null, week_start date not null,
 member text not null check(member in ('taylan','nihal','ansar','ayah')),
 opened_at timestamptz not null default now(), finished_at timestamptz,
 primary key(workspace,week_start,member)
);
-- Claimed before sending so a retry never sends twice.
create table if not exists fds_email_sends (
 workspace text not null, week_start date not null,
 kind text not null check(kind in ('reminder','stats')), recipient text not null,
 sent_at timestamptz not null default now(),
 primary key(workspace,week_start,kind,recipient)
);
alter table fds_story_views enable row level security;
alter table fds_email_sends enable row level security;
revoke all on fds_story_views,fds_email_sends from anon,authenticated;
