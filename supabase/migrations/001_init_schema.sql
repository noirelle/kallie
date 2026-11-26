-- Kallie Initial Schema Migration
-- Run this in Supabase Dashboard -> SQL Editor

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. DEVICE TOKENS (for optional Android FCM & iOS APNs VoIP lock-screen push)
-- ============================================================================
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  voip_token text,
  fcm_token text,
  device_name text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, platform)
);

alter table public.device_tokens enable row level security;

create policy "Users can view own device tokens"
  on public.device_tokens for select
  using (auth.uid() = user_id);

create policy "Users can insert own device tokens"
  on public.device_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can update own device tokens"
  on public.device_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own device tokens"
  on public.device_tokens for delete
  using (auth.uid() = user_id);

-- ============================================================================
-- 2. CALL SCHEDULES
-- ============================================================================
create table if not exists public.call_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  ai_prompt text not null default 'Have a warm, helpful check-in conversation with the user.',
  scheduled_at timestamptz not null,
  timezone text not null default 'Asia/Manila',
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly')),
  next_run_at timestamptz,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_call_schedules_due
  on public.call_schedules (status, next_run_at)
  where status = 'active';

create index if not exists idx_call_schedules_user
  on public.call_schedules (user_id, scheduled_at desc);

alter table public.call_schedules enable row level security;

create policy "Users can view own schedules"
  on public.call_schedules for select
  using (auth.uid() = user_id);

create policy "Users can insert own schedules"
  on public.call_schedules for insert
  with check (auth.uid() = user_id);

create policy "Users can update own schedules"
  on public.call_schedules for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own schedules"
  on public.call_schedules for delete
  using (auth.uid() = user_id);

-- Automatically sync updated_at and default next_run_at
create or replace function public.handle_call_schedule_defaults()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and new.next_run_at is null and new.status = 'active' then
    new.next_run_at := new.scheduled_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_call_schedule_defaults on public.call_schedules;
create trigger trg_call_schedule_defaults
  before insert or update on public.call_schedules
  for each row execute function public.handle_call_schedule_defaults();

-- ============================================================================
-- 3. CALL SESSIONS (ringing, active calls, transcripts, history)
-- ============================================================================
create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.call_schedules(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  room_name text not null unique,
  title text not null default 'Kallie Call',
  ai_prompt text not null default 'Have a warm, helpful check-in conversation with the user.',
  status text not null default 'ringing' check (
    status in ('ringing', 'accepted', 'in_progress', 'completed', 'missed', 'declined')
  ),
  started_at timestamptz,
  ended_at timestamptz,
  transcript jsonb not null default '[]'::jsonb,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_call_sessions_user_created
  on public.call_sessions (user_id, created_at desc);

create index if not exists idx_call_sessions_ringing
  on public.call_sessions (status, created_at)
  where status = 'ringing';

alter table public.call_sessions enable row level security;

create policy "Users can view own call sessions"
  on public.call_sessions for select
  using (auth.uid() = user_id);

-- Enable Supabase Realtime for live incoming call alerts on desktop & open mobile apps
alter publication supabase_realtime add table public.call_sessions;

-- ============================================================================
-- 4. ATOMIC SCHEDULER RPC (prevents duplicate calls with FOR UPDATE SKIP LOCKED)
-- ============================================================================
create or replace function public.claim_due_schedules(batch_size int default 20)
returns setof public.call_schedules
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select id
    from public.call_schedules
    where status = 'active'
      and next_run_at is not null
      and next_run_at <= now()
    order by next_run_at asc
    limit batch_size
    for update skip locked
  )
  update public.call_schedules cs
  set
    status = case
      when cs.recurrence = 'none' then 'completed'
      else 'active'
    end,
    next_run_at = case
      when cs.recurrence = 'daily' then cs.next_run_at + interval '1 day'
      when cs.recurrence = 'weekly' then cs.next_run_at + interval '7 days'
      else null
    end,
    updated_at = now()
  from due
  where cs.id = due.id
  returning cs.*;
end;
$$;

revoke all on function public.claim_due_schedules(int) from public;
grant execute on function public.claim_due_schedules(int) to service_role;
