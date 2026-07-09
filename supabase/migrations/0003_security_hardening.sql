-- Fase 0 hardening (Supabase security advisors):
--  - pin search_path on trigger function
--  - RBAC helper functions: not callable by anon via RPC (authenticated needed for RLS policies)

create or replace function public.protect_commission_share() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.commission_share is distinct from old.commission_share
     and coalesce(auth.jwt() ->> 'role', current_user) not in ('service_role','postgres','supabase_admin') then
    raise exception 'creators.commission_share is read-only (synced from platform; turun = alert, bukan edit)';
  end if;
  return new;
end $$;

revoke execute on function public.current_member_role() from anon, public;
revoke execute on function public.is_management() from anon, public;
