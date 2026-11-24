alter table public.site_capability_settings add column rerank_model text;
alter table public.knowledge_service_checks drop constraint knowledge_service_checks_capability_check;
alter table public.knowledge_service_checks add constraint knowledge_service_checks_capability_check check(capability in('embedding','ocr','asr','rerank'));
create table public.knowledge_conversations(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,title text not null,version integer not null default 0,turns jsonb not null default '[]',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.knowledge_conversations enable row level security;
create policy own_conversations on public.knowledge_conversations for select to authenticated using(user_id=(select auth.uid()));
create policy delete_conversations on public.knowledge_conversations for delete to authenticated using(user_id=(select auth.uid()));
revoke all on public.knowledge_conversations from public,anon,authenticated;
grant select,delete on public.knowledge_conversations to authenticated;
grant all on public.knowledge_conversations to service_role;
create index conversations_owner on public.knowledge_conversations(user_id,updated_at desc);
create table public.knowledge_query_events(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 mode text not null,ranking text not null,query_count integer not null,candidate_count integer not null,citation_count integer not null,duration_ms integer not null,
 degraded boolean not null,created_at timestamptz not null default now()
);
alter table public.knowledge_query_events enable row level security;
create policy own_query_events on public.knowledge_query_events for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.knowledge_query_events from public,anon,authenticated;
grant select on public.knowledge_query_events to authenticated;
grant all on public.knowledge_query_events to service_role;
create index query_events_owner on public.knowledge_query_events(user_id,created_at desc);
create function public.append_knowledge_conversation(conversation uuid,expected_version integer,question text,answer text,citations jsonb) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid:=auth.uid();thread public.knowledge_conversations;begin
 if owner is null or question is null or answer is null or length(question)=0 or jsonb_typeof(citations)<>'array' or pg_column_size(citations)>30000 or length(question)>240 or length(answer)>2400 or jsonb_array_length(citations)>20 then return null;end if;
 select * into thread from public.knowledge_conversations where id=conversation and user_id=owner for update;
 if found then if thread.version<>expected_version or thread.version>=20 then return null;end if;
 elsif expected_version<>0 then return null;
 else if (select count(*) from public.knowledge_conversations where user_id=owner)>=500 then return null;end if;insert into public.knowledge_conversations(id,user_id,title) values(conversation,owner,left(question,60)) on conflict(id) do nothing;
 select * into thread from public.knowledge_conversations where id=conversation and user_id=owner for update;if not found or thread.version<>0 then return null;end if;end if;
 if exists(select 1 from jsonb_array_elements(citations)c where not exists(select 1 from public.bookmarks b join public.bookmark_chunks k on k.bookmark_id=b.id where b.user_id=owner and b.deleted_at is null and b.id::text=c->>'bookmark_id' and k.id::text=c->>'chunk_id' and b.source_hash=c->>'source_hash' and k.source_hash=b.source_hash and length(c->>'quote')>=8 and strpos(k.content,c->>'quote')>0)) then return null;end if;
 update public.knowledge_conversations set version=version+1,turns=turns||jsonb_build_array(jsonb_build_object('question',question,'answer',answer,'citations',citations,'created_at',now())),updated_at=now() where id=conversation and user_id=owner;return thread.version+1;
end;$$;
revoke all on function public.append_knowledge_conversation(uuid,integer,text,text,jsonb) from public,anon;
grant execute on function public.append_knowledge_conversation(uuid,integer,text,text,jsonb) to authenticated;

create or replace function public.enqueue_knowledge_backup(owner_id uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('backup:'||owner_id::text,0));
 select id into result from public.knowledge_backups where user_id=owner_id and day=current_date;
 if result is not null then return result;end if;
 insert into public.knowledge_backups(user_id) values(owner_id) returning id into result;
 insert into public.knowledge_backup_rows(backup_id,table_name,payload)
select result,'bookmarks',to_jsonb(t) from public.bookmarks t where t.user_id=owner_id
 union all
select result,'bookmark_sources',to_jsonb(t) from public.bookmark_sources t where t.user_id=owner_id
 union all
select result,'bookmark_derivations',to_jsonb(t) from public.bookmark_derivations t where t.user_id=owner_id
 union all
select result,'bookmark_chunks',to_jsonb(t) from public.bookmark_chunks t where t.user_id=owner_id
 union all
select result,'bookmark_piece_summaries',to_jsonb(t) from public.bookmark_piece_summaries t where t.user_id=owner_id
 union all
select result,'bookmark_edges',to_jsonb(t) from public.bookmark_edges t where t.user_id=owner_id
 union all
select result,'bookmark_assets',to_jsonb(t) from public.bookmark_assets t where t.user_id=owner_id
 union all
select result,'knowledge_insights',to_jsonb(t) from public.knowledge_insights t where t.user_id=owner_id
 union all
select result,'knowledge_entities',to_jsonb(t) from public.knowledge_entities t where t.user_id=owner_id
 union all
select result,'knowledge_entity_revisions',to_jsonb(t) from public.knowledge_entity_revisions t where t.user_id=owner_id
 union all
select result,'knowledge_entity_updates',to_jsonb(t) from public.knowledge_entity_updates t where t.user_id=owner_id
 union all
select result,'bookmark_relation_analyses',to_jsonb(t) from public.bookmark_relation_analyses t where t.user_id=owner_id
 union all select result,'knowledge_enrichment_jobs',to_jsonb(t) from public.knowledge_enrichment_jobs t where t.user_id=owner_id
 union all select result,'knowledge_discoveries',to_jsonb(t) from public.knowledge_discoveries t where t.user_id=owner_id
 union all select result,'knowledge_conversations',to_jsonb(t) from public.knowledge_conversations t where t.user_id=owner_id;
 return result;
end;
$$;

create or replace function public.commit_knowledge_restore(restore_id uuid) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid;tbl text;cols text;row_count integer:=0;added integer;
begin
 select user_id into owner from public.knowledge_restore_sessions where id=restore_id for update;
 if owner is null then raise exception 'Restore session missing';end if;
 perform pg_advisory_xact_lock(hashtextextended('restore:'||owner::text,0));
 perform set_config('cheesecool.restoring','on',true);
 if exists(select 1 from public.bookmarks where user_id=owner) then raise exception 'Restore target must be empty';end if;
 if exists(select 1 from public.knowledge_restore_rows where session_id=restore_id and (payload->>'user_id' is distinct from owner::text or table_name not in('bookmarks','bookmark_sources','bookmark_derivations','bookmark_chunks','bookmark_piece_summaries','bookmark_edges','bookmark_assets','knowledge_insights','knowledge_entities','knowledge_entity_revisions','knowledge_entity_updates','bookmark_relation_analyses','knowledge_enrichment_jobs','knowledge_discoveries','knowledge_conversations'))) then raise exception 'Invalid restore scope';end if;
 foreach tbl in array array['bookmarks','bookmark_sources','bookmark_derivations','bookmark_chunks','bookmark_piece_summaries','bookmark_edges','bookmark_assets','knowledge_insights','knowledge_entities','knowledge_entity_revisions','knowledge_entity_updates','bookmark_relation_analyses','knowledge_enrichment_jobs','knowledge_discoveries','knowledge_conversations'] loop
 select string_agg(quote_ident(column_name),',' order by ordinal_position) into cols from information_schema.columns where table_schema='public' and table_name=tbl and is_generated='NEVER' and is_identity='NO';
 -- merged_into can refer to a later entity, set after all entity inserts.
 if tbl='knowledge_entities' then
 execute format('insert into public.%I(%s) select %s from public.knowledge_restore_rows r cross join lateral jsonb_populate_record(null::public.%I,r.payload||jsonb_build_object(''merged_into'',null)) p where r.session_id=$1 and r.table_name=$2',tbl,cols,(select string_agg('p.'||quote_ident(column_name),',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name=tbl and is_generated='NEVER' and is_identity='NO'),tbl) using restore_id,tbl;
 else
 execute format('insert into public.%I(%s) select %s from public.knowledge_restore_rows r cross join lateral jsonb_populate_record(null::public.%I,r.payload) p where r.session_id=$1 and r.table_name=$2',tbl,cols,(select string_agg('p.'||quote_ident(column_name),',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name=tbl and is_generated='NEVER' and is_identity='NO'),tbl) using restore_id,tbl;
 end if;
 get diagnostics added=row_count;row_count:=row_count+added;
 end loop;
 update public.knowledge_entities e set merged_into=(r.payload->>'merged_into')::uuid from public.knowledge_restore_rows r where r.session_id=restore_id and r.table_name='knowledge_entities' and e.id=(r.payload->>'id')::uuid and e.user_id=owner;
 update public.bookmark_jobs j set state=case when b.status='indexed' then 'complete' else 'queued' end,stage=case when b.status='indexed' then 'complete' else 'extract' end from public.bookmarks b where b.user_id=owner and j.bookmark_id=b.id;
 update public.knowledge_enrichment_jobs set state=case when state='running' then 'queued' else state end,lease_token=null,lease_until=null,available_at=now() where user_id=owner;
 delete from public.knowledge_restore_sessions where id=restore_id;return row_count;
end;$$;
