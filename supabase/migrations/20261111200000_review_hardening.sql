-- Review hardening: trigger functions are never meant to be called through the API, so nobody outside the database may execute them.
revoke execute on function public.apply_invites() from public, anon, authenticated;
revoke execute on function public.touch() from public, anon, authenticated;
