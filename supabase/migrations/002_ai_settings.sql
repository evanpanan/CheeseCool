create table public.ai_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  provider text not null default 'openai' check (provider in ('openai','kimi','deepseek')),
  model text,
  openai_key text,
  kimi_key text,
  deepseek_key text
);
alter table public.ai_settings enable row level security;
create policy own_ai_settings on public.ai_settings to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.ai_settings from public, anon;
grant select, insert, update on public.ai_settings to authenticated;
