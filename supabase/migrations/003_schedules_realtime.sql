-- Enable Supabase Realtime for call_schedules so voice-created or multi-device
-- schedule updates synchronize immediately to local SQLite without polling.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_schedules'
  ) then
    alter publication supabase_realtime add table public.call_schedules;
  end if;
end $$;
