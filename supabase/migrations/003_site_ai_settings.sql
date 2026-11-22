create table public.site_ai_settings (
  id boolean primary key default true check (id),
  provider text not null default 'openai' check (provider in ('openai','kimi','deepseek')),
  model text,
  openai_key text,
  kimi_key text,
  deepseek_key text
);
alter table public.site_ai_settings enable row level security;
revoke all on public.site_ai_settings from public, anon, authenticated;
grant select, insert, update on public.site_ai_settings to service_role;

-- Disable the retired per-user configuration without deleting saved rows.
revoke all on public.ai_settings from public, anon, authenticated;
