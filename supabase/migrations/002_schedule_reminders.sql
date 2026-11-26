-- Kallie Scheduled Call Reminders Migration
-- Adds pre-call reminder tracking (default 10 minutes before scheduled call)
-- and an atomic claim_due_reminders RPC to prevent duplicate reminder notifications.

alter table public.call_schedules
  add column if not exists reminder_offset_minutes integer not null default 10,
  add column if not exists reminder_sent_at timestamptz;

create index if not exists idx_call_schedules_reminders
  on public.call_schedules (status, next_run_at)
  where status = 'active' and reminder_sent_at is null;

-- Keep recurring schedules clean: reset reminder_sent_at when advancing next_run_at
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
    reminder_sent_at = case
      when cs.recurrence in ('daily', 'weekly') then null
      else cs.reminder_sent_at
    end,
    updated_at = now()
  from due
  where cs.id = due.id
  returning cs.*;
end;
$$;

-- Atomically claim schedules due for their pre-call reminder notification
create or replace function public.claim_due_reminders(batch_size int default 20)
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
      and reminder_sent_at is null
      and reminder_offset_minutes > 0
      and next_run_at > now() + interval '30 seconds'
      and next_run_at <= now() + make_interval(mins => reminder_offset_minutes)
    order by next_run_at asc
    limit batch_size
    for update skip locked
  )
  update public.call_schedules cs
  set
    reminder_sent_at = now(),
    updated_at = now()
  from due
  where cs.id = due.id
  returning cs.*;
end;
$$;

revoke all on function public.claim_due_reminders(int) from public;
grant execute on function public.claim_due_reminders(int) to service_role;
