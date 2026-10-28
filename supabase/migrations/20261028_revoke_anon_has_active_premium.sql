-- has_active_premium() only answers for auth.uid(); anon has no reason to call it.
revoke all on function public.has_active_premium() from public, anon;
grant execute on function public.has_active_premium() to authenticated, service_role;
