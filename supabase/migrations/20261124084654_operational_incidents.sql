alter table public.knowledge_backups add column updated_at timestamptz not null default now();
create table public.knowledge_incidents(
 user_id uuid not null references auth.users(id) on delete cascade,code text not null,state text not null check(state in('active','resolved')),affected integer not null,first_seen timestamptz not null default now(),last_seen timestamptz not null default now(),primary key(user_id,code)
);
alter table public.knowledge_incidents enable row level security;
create policy own_incidents on public.knowledge_incidents for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.knowledge_incidents from public,anon,authenticated;
grant select on public.knowledge_incidents to authenticated;
grant all on public.knowledge_incidents to service_role;
create function public.check_knowledge_incidents() returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer;begin
 create temporary table if not exists current_incidents(user_id uuid,code text,affected integer) on commit drop;
 truncate current_incidents;
 insert into current_incidents select user_id,'ingestion_failed',count(*) from public.bookmark_jobs where state='failed' group by user_id having count(*)>=1;
 insert into current_incidents select user_id,'analysis_failed',count(*) from public.knowledge_enrichment_jobs where state='failed' group by user_id;
 insert into current_incidents select user_id,'backup_failed',count(*) from public.knowledge_backups where state='failed' group by user_id;
 insert into current_incidents select user_id,'processing_stalled',count(*) from public.bookmark_jobs where state in('queued','running') and available_at<now() and updated_at<now()-interval '30 minutes' group by user_id;
 insert into current_incidents select user_id,'backup_stalled',count(*) from public.knowledge_backups where state in('queued','running') and updated_at<now()-interval '30 minutes' group by user_id;
 insert into current_incidents select user_id,'query_degraded',count(*) filter(where degraded) from public.knowledge_query_events where created_at>now()-interval '1 hour' group by user_id having count(*)>=5 and count(*) filter(where degraded)::float/count(*)>.25;
 update public.knowledge_incidents i set state='resolved',last_seen=now() where state='active' and not exists(select 1 from current_incidents c where c.user_id=i.user_id and c.code=i.code);
 insert into public.knowledge_incidents(user_id,code,state,affected) select user_id,code,'active',affected from current_incidents on conflict(user_id,code) do update set state='active',affected=excluded.affected,last_seen=now(),first_seen=case when knowledge_incidents.state='resolved' then now() else knowledge_incidents.first_seen end;
 get diagnostics changed=row_count;return changed;
end;$$;
revoke all on function public.check_knowledge_incidents() from public,anon,authenticated;
grant execute on function public.check_knowledge_incidents() to service_role;
create function public.knowledge_diagnostics(owner_id uuid default null) returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('queries',(select jsonb_build_object('total',count(*),'degraded',count(*) filter(where degraded),'with_citations',count(*) filter(where citation_count>0),'p95_ms',percentile_cont(.95) within group(order by duration_ms)) from public.knowledge_query_events where (owner_id is null or user_id=owner_id) and created_at>now()-interval '24 hours'),
 'automation',(select coalesce(jsonb_object_agg(state,n),'{}') from(select state,count(*) n from public.knowledge_enrichment_jobs where owner_id is null or user_id=owner_id group by state)s),
 'incidents',(select coalesce(jsonb_agg(to_jsonb(i)-'user_id'),'[]') from public.knowledge_incidents i where (owner_id is null or user_id=owner_id) and state='active'));
$$;
revoke all on function public.knowledge_diagnostics(uuid) from public,anon,authenticated;
grant execute on function public.knowledge_diagnostics(uuid) to service_role;
