-- L'Arène des Cogneurs : schéma Postgres (Supabase)
-- Toutes les tables ont la sécurité par ligne (RLS) activée SANS politique :
-- elles sont donc invisibles via les clés publiques de Supabase. Seul le serveur
-- (connexion Postgres directe, variable DATABASE_URL) peut y lire et écrire.

create table if not exists users (
  id bigserial primary key,
  username text not null,
  pass text not null,
  created bigint not null
);
create unique index if not exists users_username_lower on users (lower(username));

create table if not exists sessions (
  token text primary key,
  user_id bigint not null references users(id) on delete cascade,
  expires bigint not null
);
create index if not exists sessions_user on sessions (user_id);

create table if not exists brutes (
  id bigserial primary key,
  user_id bigint not null unique references users(id) on delete cascade,
  name text not null,
  level int not null default 1,
  data jsonb not null,
  state jsonb not null,
  created bigint not null
);
create unique index if not exists brutes_name_lower on brutes (lower(name));
create index if not exists brutes_level on brutes (level);

-- Élèves : chaque cogneur peut avoir un maître
alter table brutes add column if not exists master_id bigint references brutes(id) on delete set null;
create index if not exists brutes_master on brutes (master_id);

create table if not exists fights (
  id bigserial primary key,
  brute_id bigint not null references brutes(id) on delete cascade,
  opp_brute_id bigint references brutes(id) on delete set null,
  a jsonb not null,
  b jsonb not null,
  seed bigint not null,
  won boolean not null,
  xp int not null,
  event text,
  created bigint not null
);
create index if not exists fights_brute on fights (brute_id, id desc);
create index if not exists fights_opp on fights (opp_brute_id, id desc);

create table if not exists rate_hits (
  id bigserial primary key,
  k text not null,
  ts bigint not null
);
create index if not exists rate_hits_k on rate_hits (k, ts);

create table if not exists event_scores (
  event_id text not null,
  camp text not null,
  points int not null default 0,
  primary key (event_id, camp)
);

alter table users enable row level security;
alter table sessions enable row level security;
alter table brutes enable row level security;
alter table fights enable row level security;
alter table rate_hits enable row level security;
alter table event_scores enable row level security;
