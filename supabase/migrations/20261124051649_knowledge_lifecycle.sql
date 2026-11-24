create table public.knowledge_service_checks(
 capability text primary key check(capability in ('embedding','ocr','asr')),provider text not null,model text not null,fingerprint text not null,
 state text not null check(state in ('running','passed','failed')),remote_task_id text,message text,updated_at timestamptz not null default now()
);
alter table public.knowledge_service_checks enable row level security;
revoke all on public.knowledge_service_checks from public,anon,authenticated;
grant all on public.knowledge_service_checks to service_role;

create function public.knowledge_health_summary(owner_id uuid default null) returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object(
 'jobs',(select coalesce(jsonb_object_agg(state,n),'{}') from (select state,count(*) n from public.bookmark_jobs where owner_id is null or user_id=owner_id group by state) j),
 'last24h',(select jsonb_build_object('complete',count(*) filter(where state='complete'),'failed',count(*) filter(where state='failed'),'limited',count(*) filter(where state='limited'),'waiting',count(*) filter(where state='waiting'),'average_duration_ms',round(avg(duration_ms)),'last_event_at',max(created_at)) from public.knowledge_job_events where (owner_id is null or user_id=owner_id) and created_at>now()-interval '24 hours'),
 'oldest_pending',(select min(created_at) from public.bookmark_jobs where (owner_id is null or user_id=owner_id) and state in ('queued','running','waiting')),
 'original_bytes',(select coalesce(sum(bytes),0) from public.bookmark_assets where owner_id is null or user_id=owner_id),
 'errors',(select coalesce(jsonb_agg(e),'[]') from (select error_code,count(*) count from public.knowledge_job_events where (owner_id is null or user_id=owner_id) and created_at>now()-interval '24 hours' and error_code is not null group by error_code order by count(*) desc limit 10)e)
 );
$$;
revoke all on function public.knowledge_health_summary(uuid) from public,anon,authenticated;
grant execute on function public.knowledge_health_summary(uuid) to service_role;
