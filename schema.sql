-- Radar Culturale — Schema Supabase
-- Esegui questo nell'SQL Editor di Supabase

-- Tabella segnali automatici settimanali
create table if not exists weekly_trends (
  id uuid default gen_random_uuid() primary key,
  week_key text not null,
  category text not null,
  platform text,
  title text not null,
  description text not null,
  intensity text,
  source text default 'auto',
  created_at timestamp with time zone default now()
);

-- Tabella segnali manuali
create table if not exists manual_signals (
  id uuid default gen_random_uuid() primary key,
  week_key text not null,
  category text not null,
  text text not null,
  level integer default 2,
  source text default 'manuale',
  created_at timestamp with time zone default now()
);

-- Tabella letture settimanali
create table if not exists weekly_syntheses (
  id uuid default gen_random_uuid() primary key,
  week_key text unique not null,
  content text not null,
  updated_at timestamp with time zone default now()
);

-- Indici per performance
create index if not exists idx_trends_week on weekly_trends(week_key);
create index if not exists idx_signals_week on manual_signals(week_key);

-- RLS: disabilita per uso personale (dashboard privata)
alter table weekly_trends disable row level security;
alter table manual_signals disable row level security;
alter table weekly_syntheses disable row level security;
