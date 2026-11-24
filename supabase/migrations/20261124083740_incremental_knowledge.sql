create table public.knowledge_enrichment_jobs(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,bookmark_id uuid not null references public.bookmarks(id) on delete cascade,source_hash text not null,
 state text not null default 'queued' check(state in('queued','running','complete','failed','cancelled')),stage text not null default 'entities' check(stage in('entities','relations','complete')),ordinal integer not null default 0,
 candidates jsonb,lease_token uuid,lease_until timestamptz,available_at timestamptz not null default now(),attempts integer not null default 0,error_message text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(bookmark_id,source_hash)
);
create table public.knowledge_discoveries(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,job_id uuid not null references public.knowledge_enrichment_jobs(id) on delete cascade,
 kind text not null check(kind in('entity','duplicate')),fingerprint text not null,payload jsonb not null,source_ids uuid[] not null,source_versions jsonb not null,evidence jsonb not null,
 state text not null default 'pending' check(state in('pending','accepted','rejected')),created_at timestamptz not null default now(),reviewed_at timestamptz,unique(job_id,kind,fingerprint)
);
alter table public.knowledge_enrichment_jobs enable row level security;
alter table public.knowledge_discoveries enable row level security;
create policy own_enrichment on public.knowledge_enrichment_jobs for select to authenticated using(user_id=(select auth.uid()));
create policy own_discoveries on public.knowledge_discoveries for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.knowledge_enrichment_jobs,public.knowledge_discoveries from public,anon,authenticated;
grant select on public.knowledge_enrichment_jobs,public.knowledge_discoveries to authenticated;
grant all on public.knowledge_enrichment_jobs,public.knowledge_discoveries to service_role;
create index enrichment_due on public.knowledge_enrichment_jobs(state,available_at,lease_until);
create index enrichment_owner on public.knowledge_enrichment_jobs(user_id,created_at desc);
create index discoveries_owner on public.knowledge_discoveries(user_id,state,created_at desc);
create function internal.enqueue_enrichment() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if current_setting('cheesecool.restoring',true)='on' then return new;end if;
 if new.deleted_at is null and new.source_hash is not null and length(new.content)>0 and new.ai_summary is not null and new.record_type<>'knowledge_note' then
 insert into public.knowledge_enrichment_jobs(user_id,bookmark_id,source_hash) values(new.user_id,new.id,new.source_hash) on conflict(bookmark_id,source_hash) do nothing;end if;return new;
end;$$;
revoke all on function internal.enqueue_enrichment() from public,anon,authenticated;
create trigger enqueue_enrichment after insert or update of source_hash,ai_summary,deleted_at on public.bookmarks for each row execute function internal.enqueue_enrichment();
insert into public.knowledge_enrichment_jobs(user_id,bookmark_id,source_hash) select user_id,id,source_hash from public.bookmarks where deleted_at is null and source_hash is not null and length(content)>0 and ai_summary is not null and record_type<>'knowledge_note' on conflict do nothing;
create function public.claim_knowledge_enrichment(owner_id uuid default null) returns setof public.knowledge_enrichment_jobs language plpgsql security definer set search_path=public,internal,pg_temp as $$
declare candidate public.knowledge_enrichment_jobs;used integer;begin
 update public.knowledge_enrichment_jobs j set state='cancelled',lease_until=null where state in('queued','running') and not exists(select 1 from public.bookmarks b where b.id=j.bookmark_id and b.user_id=j.user_id and b.source_hash=j.source_hash and b.deleted_at is null);
 select * into candidate from public.knowledge_enrichment_jobs where (owner_id is null or user_id=owner_id) and state in('queued','running') and attempts<4 and available_at<=now() and (lease_until is null or lease_until<now()) order by available_at,created_at for update skip locked limit 1;if not found then return;end if;
 insert into internal.knowledge_limits(user_id,action,window_start,requests) values(candidate.user_id,'enrichment',date_trunc('day',now()),1) on conflict(user_id,action,window_start) do update set requests=knowledge_limits.requests+1 where knowledge_limits.requests<100 returning requests into used;
 if used is null then update public.knowledge_enrichment_jobs set available_at=date_trunc('day',now())+interval '1 day',error_message='自动分析今日额度已用完，明日继续' where id=candidate.id;return;end if;
 return query update public.knowledge_enrichment_jobs set state='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() where id=candidate.id returning *;
end;$$;
revoke all on function public.claim_knowledge_enrichment(uuid) from public,anon,authenticated;
grant execute on function public.claim_knowledge_enrichment(uuid) to service_role;
create function public.enrichment_candidates(record_id uuid,owner_id uuid,expected_hash text) returns jsonb language sql stable security invoker set search_path=public,extensions as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'hash',source_hash)),'[]') from(
 select b.id,b.source_hash from public.bookmarks a join public.bookmarks b on b.user_id=a.user_id and b.id<>a.id and b.deleted_at is null and length(b.content)>0 and b.source_hash is not null
 where a.id=record_id and a.user_id=owner_id and a.source_hash=expected_hash and a.deleted_at is null
 and (a.source_hash=b.source_hash or a.tags&&b.tags or (a.embedding is not null and b.embedding is not null and a.embedding_space=b.embedding_space and 1-(a.embedding<=>b.embedding)>.65))
 order by (a.source_hash=b.source_hash) desc,(select count(*) from unnest(a.tags)t where t=any(b.tags)) desc,b.created_at desc,b.id limit 3) x;
$$;
revoke all on function public.enrichment_candidates(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.enrichment_candidates(uuid,uuid,text) to service_role;
create function public.finish_knowledge_enrichment(work_id uuid,token uuid,checkpoint jsonb,proposals jsonb default '[]',relation jsonb default null) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.knowledge_enrichment_jobs;p jsonb;begin
 select * into j from public.knowledge_enrichment_jobs where id=work_id and lease_token=token and state='running' for update;if not found then return false;end if;
 if not exists(select 1 from public.bookmarks b where b.id=j.bookmark_id and b.user_id=j.user_id and b.source_hash=j.source_hash and b.deleted_at is null) then update public.knowledge_enrichment_jobs set state='cancelled',lease_until=null where id=j.id;return false;end if;
 for p in select * from jsonb_array_elements(proposals) loop
 if exists(select 1 from jsonb_each_text(p->'source_versions')v where not exists(select 1 from public.bookmarks b where b.id::text=v.key and b.user_id=j.user_id and b.source_hash=v.value and b.deleted_at is null)) then return false;end if;
 if exists(select 1 from jsonb_array_elements(p->'evidence')e where length(e->>'quote')<8 or not exists(select 1 from public.bookmarks b where b.id::text=e->>'source_id' and b.user_id=j.user_id and b.source_hash=e->>'source_hash' and b.deleted_at is null and strpos(b.content,e->>'quote')>0)) then return false;end if;
 insert into public.knowledge_discoveries(user_id,job_id,kind,fingerprint,payload,source_ids,source_versions,evidence) values(j.user_id,j.id,p->>'kind',p->>'fingerprint',p->'payload',array(select jsonb_array_elements_text(p->'source_ids')::uuid),p->'source_versions',p->'evidence') on conflict(job_id,kind,fingerprint) do nothing;
 end loop;
 if relation is not null then
 if not exists(select 1 from public.bookmarks b where b.id::text=relation->>'target_id' and b.user_id=j.user_id and b.source_hash=relation->>'target_hash' and b.deleted_at is null) or not exists(select 1 from public.bookmarks b where b.id::text=relation->>'source_id' and b.user_id=j.user_id and b.source_hash=relation->>'source_hash' and b.deleted_at is null) then return false;end if;
 insert into public.bookmark_relation_analyses(user_id,source_id,target_id,source_hash,target_hash,kind,reason,evidence,provider,model,prompt_version) values(j.user_id,(relation->>'source_id')::uuid,(relation->>'target_id')::uuid,relation->>'source_hash',relation->>'target_hash',relation->>'kind',relation->>'reason',relation->'evidence',relation->>'provider',relation->>'model',relation->>'prompt_version') on conflict(user_id,source_id,target_id,source_hash,target_hash,provider,model,prompt_version) do nothing;
 end if;
 update public.knowledge_enrichment_jobs set stage=coalesce(checkpoint->>'stage',stage),ordinal=coalesce((checkpoint->>'ordinal')::integer,ordinal),candidates=coalesce(checkpoint->'candidates',candidates),state=case when checkpoint->>'stage'='complete' then 'complete' else 'queued' end,attempts=0,lease_until=null,available_at=now(),error_message=null,updated_at=now() where id=j.id;return true;
end;$$;
revoke all on function public.finish_knowledge_enrichment(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_knowledge_enrichment(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
create function public.review_knowledge_discovery(discovery_id uuid,accept_proposal boolean) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid:=auth.uid();d public.knowledge_discoveries;e public.knowledge_entities;begin
 if owner is null then return false;end if;
 select * into d from public.knowledge_discoveries where id=discovery_id and user_id=owner and state='pending' for update;if not found then return false;end if;
 if accept_proposal then
 if exists(select 1 from unnest(d.source_ids)s where not exists(select 1 from public.bookmarks b where b.id=s and b.user_id=owner and b.deleted_at is null and b.source_hash=d.source_versions->>s::text)) then return false;end if;
 if exists(select 1 from jsonb_array_elements(d.evidence)q where not exists(select 1 from public.bookmarks b where b.id::text=q->>'source_id' and b.user_id=owner and b.source_hash=q->>'source_hash' and b.deleted_at is null and strpos(b.content,q->>'quote')>0)) then return false;end if;
 if d.kind='entity' then
 perform pg_advisory_xact_lock(hashtextextended(owner::text||':'||(d.payload->>'kind')||':'||(d.payload->>'name'),0));
 select * into e from public.knowledge_entities where user_id=owner and merged_into is null and kind=d.payload->>'kind' and (name=d.payload->>'name' or d.payload->>'name'=any(aliases)) order by confirmed_at desc limit 1 for update;
 if e.id is null then insert into public.knowledge_entities(user_id,name,kind,description,source_ids,source_versions) values(owner,d.payload->>'name',d.payload->>'kind',d.payload->>'description',d.source_ids,d.source_versions);
 elsif e.description<>d.payload->>'description' then insert into public.knowledge_entity_updates(user_id,entity_id,base_version,new_description,source_ids,source_versions,evidence) values(owner,e.id,e.version,d.payload->>'description',d.source_ids,d.source_versions,d.evidence);
 else insert into public.knowledge_entity_revisions(user_id,entity_id,before_data,after_data,reason) values(owner,e.id,to_jsonb(e),jsonb_build_object('source_versions',d.source_versions),'user_confirmed_source');update public.knowledge_entities set source_ids=(select array_agg(distinct s) from unnest(e.source_ids||d.source_ids)s),source_versions=source_versions||d.source_versions,version=version+1 where id=e.id;end if;
 end if;end if;
 update public.knowledge_discoveries set state=case when accept_proposal then 'accepted' else 'rejected' end,reviewed_at=now() where id=d.id;return true;
end;$$;
revoke all on function public.review_knowledge_discovery(uuid,boolean) from public,anon;
grant execute on function public.review_knowledge_discovery(uuid,boolean) to authenticated;

create function public.retry_knowledge_enrichment(work_id uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$ begin
 update public.knowledge_enrichment_jobs j set state='queued',attempts=0,error_message=null,available_at=now(),lease_until=null where id=work_id and user_id=auth.uid() and state='failed' and exists(select 1 from public.bookmarks b where b.id=j.bookmark_id and b.user_id=auth.uid() and b.source_hash=j.source_hash and b.deleted_at is null);return found;
end;$$;
revoke all on function public.retry_knowledge_enrichment(uuid) from public,anon;
grant execute on function public.retry_knowledge_enrichment(uuid) to authenticated;
