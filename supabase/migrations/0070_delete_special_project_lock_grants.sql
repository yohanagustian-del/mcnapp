-- delete_special_project() (0069) is SECURITY DEFINER = bypasses RLS by design,
-- so it must NOT keep PostgREST's default grants to anon/authenticated — as
-- applied, anyone holding the public anon key could call
-- /rest/v1/rpc/delete_special_project directly and delete any project, skipping
-- requireProjectLead (SPV/Head/Director) in deleteProject entirely. Only the
-- service-role client (createAdminClient(), used by that server action) may
-- call it now.
revoke execute on function delete_special_project(bigint) from public, anon, authenticated;
grant execute on function delete_special_project(bigint) to service_role;
