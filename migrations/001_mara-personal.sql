-- Mara Personal · Database Schema
-- Run once in the Supabase SQL editor.
-- Idempotent: safe to run again.
-- UK English. No em or en dashes.
--
-- Tables created:
--   personal_life_model      The eight-layer model of the user
--   personal_sessions        Coaching sessions with ORBIT stage tracking
--   personal_messages        Per-session message history
--   personal_journal         Journal entries and reflections
--   personal_theme_threads   Named threads connecting journal entries over time
--   personal_pattern_candidates  Pattern Radar accumulator
--
-- Depends on: profiles table (existing).
--
-- (c) 2026 Jade Matthew. All rights reserved.

begin;

------------------------------------------------------------------------
-- 1. Life Model entries
------------------------------------------------------------------------

create table if not exists public.personal_life_model (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  layer         text not null check (layer in (
                  'identity', 'values', 'emotional',
                  'behaviour', 'relationship', 'ambition',
                  'confidence', 'growth')),
  content       text not null,
  confidence    numeric(3,2) not null default 0.30
                check (confidence >= 0.0 and confidence <= 1.0),
  source        text not null default 'conversation'
                check (source in ('seed', 'conversation', 'journal', 'voice', 'user')),
  status        text not null default 'active'
                check (status in ('active', 'revised', 'retired')),
  user_locked   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists personal_life_model_user_layer
  on public.personal_life_model(user_id, layer)
  where status = 'active';

------------------------------------------------------------------------
-- 2. Personal coaching sessions
------------------------------------------------------------------------

create table if not exists public.personal_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  session_type    text not null default 'open'
                  check (session_type in (
                    'open', 'breakthrough', 'decision',
                    'confidence', 'anxiety', 'relationship', 'direction')),
  orbit_stage     text not null default 'observe'
                  check (orbit_stage in ('observe', 'regulate', 'become', 'integrate', 'track')),
  mode            text not null default 'companion'
                  check (mode in ('therapist', 'coach', 'mentor', 'companion')),
  theme           text,
  belief_worked   text,
  action_set      text,
  state_shift     text,
  mirror_moment   text,
  started_at      timestamptz not null default now(),
  closed_at       timestamptz,
  updated_at      timestamptz not null default now()
);

create index if not exists personal_sessions_user
  on public.personal_sessions(user_id, started_at desc);

------------------------------------------------------------------------
-- 3. Per-session message history
------------------------------------------------------------------------

create table if not exists public.personal_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.personal_sessions(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists personal_messages_session
  on public.personal_messages(session_id, created_at);

------------------------------------------------------------------------
-- 4. Journal entries
------------------------------------------------------------------------

create table if not exists public.personal_journal (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  prompt        text,
  body          text not null,
  modality      text not null default 'text'
                check (modality in ('text', 'voice')),
  themes        text[],
  emotional_markers text[],
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists personal_journal_user
  on public.personal_journal(user_id, created_at desc);

------------------------------------------------------------------------
-- 5. Theme threads
------------------------------------------------------------------------

create table if not exists public.personal_theme_threads (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  name              text not null,
  entry_ids         uuid[],
  first_seen        timestamptz not null default now(),
  last_seen         timestamptz not null default now(),
  evolution_summary text
);

create index if not exists personal_theme_threads_user
  on public.personal_theme_threads(user_id);

------------------------------------------------------------------------
-- 6. Pattern Radar candidates
------------------------------------------------------------------------

create table if not exists public.personal_pattern_candidates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  signature   text not null,
  instances   jsonb not null default '[]',
  confidence  numeric(3,2) not null default 0.0
              check (confidence >= 0.0 and confidence <= 1.0),
  pattern_type text not null
               check (pattern_type in (
                 'anxiety_spiral', 'burnout', 'avoidance',
                 'confidence_collapse', 'self_sabotage',
                 'perfectionism', 'loop')),
  status      text not null default 'watching'
              check (status in ('watching', 'surfaceable', 'surfaced', 'shifting')),
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create index if not exists personal_pattern_candidates_user
  on public.personal_pattern_candidates(user_id, status);

------------------------------------------------------------------------
-- 7. Updated_at triggers
------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  create trigger personal_life_model_updated_at
    before update on public.personal_life_model
    for each row execute function public.set_updated_at();
exception when duplicate_object then null;
end $$;

do $$ begin
  create trigger personal_sessions_updated_at
    before update on public.personal_sessions
    for each row execute function public.set_updated_at();
exception when duplicate_object then null;
end $$;

do $$ begin
  create trigger personal_journal_updated_at
    before update on public.personal_journal
    for each row execute function public.set_updated_at();
exception when duplicate_object then null;
end $$;

------------------------------------------------------------------------
-- 8. RLS (row level security)
------------------------------------------------------------------------

alter table public.personal_life_model enable row level security;
alter table public.personal_sessions enable row level security;
alter table public.personal_messages enable row level security;
alter table public.personal_journal enable row level security;
alter table public.personal_theme_threads enable row level security;
alter table public.personal_pattern_candidates enable row level security;

-- Service role bypasses RLS, so server.js with the service key has full access.
-- Anon reads are blocked by default.

commit;
