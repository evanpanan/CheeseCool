create or replace function public.enqueue_knowledge_backup(owner_id uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare backup_record_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('backup:'||owner_id::text,0));
 select id into backup_record_id from public.knowledge_backups where user_id=owner_id and day=current_date;
 if backup_record_id is not null then return backup_record_id;end if;
 insert into public.knowledge_backups(user_id) values(owner_id) returning id into backup_record_id;
 insert into public.knowledge_backup_rows(backup_id,table_name,payload)
select backup_record_id,'bookmarks',to_jsonb(t) from public.bookmarks t where t.user_id=owner_id
 union all
select backup_record_id,'bookmark_sources',to_jsonb(t) from public.bookmark_sources t where t.user_id=owner_id
 union all
select backup_record_id,'bookmark_derivations',to_jsonb(t) from public.bookmark_derivations t where t.user_id=owner_id
 union all
select backup_record_id,'bookmark_chunks',to_jsonb(t) from public.bookmark_chunks t where t.user_id=owner_id
 union all
select backup_record_id,'bookmark_piece_summaries',to_jsonb(t) from public.bookmark_piece_summaries t where t.user_id=owner_id
 union all
select backup_record_id,'bookmark_edges',to_jsonb(t) from public.bookmark_edges t where t.user_id=owner_id
 union all
select backup_record_id,'bookmark_assets',to_jsonb(t) from public.bookmark_assets t where t.user_id=owner_id
 union all
select backup_record_id,'knowledge_insights',to_jsonb(t) from public.knowledge_insights t where t.user_id=owner_id
 union all
select backup_record_id,'knowledge_entities',to_jsonb(t) from public.knowledge_entities t where t.user_id=owner_id
 union all
select backup_record_id,'knowledge_entity_revisions',to_jsonb(t) from public.knowledge_entity_revisions t where t.user_id=owner_id
 union all
select backup_record_id,'knowledge_entity_updates',to_jsonb(t) from public.knowledge_entity_updates t where t.user_id=owner_id
 union all
select backup_record_id,'bookmark_relation_analyses',to_jsonb(t) from public.bookmark_relation_analyses t where t.user_id=owner_id
 union all select backup_record_id,'knowledge_enrichment_jobs',to_jsonb(t) from public.knowledge_enrichment_jobs t where t.user_id=owner_id
 union all select backup_record_id,'knowledge_discoveries',to_jsonb(t) from public.knowledge_discoveries t where t.user_id=owner_id
 union all select backup_record_id,'knowledge_conversations',to_jsonb(t) from public.knowledge_conversations t where t.user_id=owner_id
 union all select backup_record_id,'knowledge_source_tasks',to_jsonb(t) from public.knowledge_source_tasks t where t.user_id=owner_id
 union all select backup_record_id,'knowledge_source_watches',to_jsonb(t) from public.knowledge_source_watches t where t.user_id=owner_id
 union all select backup_record_id,'knowledge_refresh_candidates',to_jsonb(t) from public.knowledge_refresh_candidates t where t.user_id=owner_id;
 return backup_record_id;
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
 if exists(select 1 from public.knowledge_restore_rows where session_id=restore_id and (payload->>'user_id' is distinct from owner::text or table_name not in('bookmarks','bookmark_sources','bookmark_derivations','bookmark_chunks','bookmark_piece_summaries','bookmark_edges','bookmark_assets','knowledge_insights','knowledge_entities','knowledge_entity_revisions','knowledge_entity_updates','bookmark_relation_analyses','knowledge_enrichment_jobs','knowledge_discoveries','knowledge_conversations','knowledge_source_tasks','knowledge_source_watches','knowledge_refresh_candidates'))) then raise exception 'Invalid restore scope';end if;
 foreach tbl in array array['bookmarks','bookmark_sources','bookmark_derivations','bookmark_chunks','bookmark_piece_summaries','bookmark_edges','bookmark_assets','knowledge_insights','knowledge_entities','knowledge_entity_revisions','knowledge_entity_updates','bookmark_relation_analyses','knowledge_enrichment_jobs','knowledge_discoveries','knowledge_conversations','knowledge_source_tasks','knowledge_source_watches','knowledge_refresh_candidates'] loop
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
 update public.knowledge_source_tasks set state=case when state='running' then 'queued' else state end,lease_token=null,lease_until=null,available_at=now() where user_id=owner;
 delete from public.knowledge_restore_sessions where id=restore_id;return row_count;
end;$$;

create or replace function public.check_knowledge_incidents() returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer;begin
 create temporary table if not exists current_incidents(user_id uuid,code text,affected integer) on commit drop;
 truncate current_incidents;
 insert into current_incidents select user_id,'ingestion_failed',count(*) from public.bookmark_jobs where state='failed' group by user_id having count(*)>=1;
 insert into current_incidents select user_id,'analysis_failed',count(*) from public.knowledge_enrichment_jobs where state='failed' group by user_id;
 insert into current_incidents select user_id,'backup_failed',count(*) from public.knowledge_backups where state='failed' group by user_id;
 insert into current_incidents select user_id,'processing_stalled',count(*) from public.bookmark_jobs where state in('queued','running') and available_at<now() and updated_at<now()-interval '30 minutes' group by user_id;
 insert into current_incidents select user_id,'backup_stalled',count(*) from public.knowledge_backups where state in('queued','running') and updated_at<now()-interval '30 minutes' group by user_id;
 insert into current_incidents select user_id,'query_degraded',count(*) filter(where degraded) from public.knowledge_query_events where created_at>now()-interval '1 hour' group by user_id having count(*)>=5 and count(*) filter(where degraded)::float/count(*)>.25;
 insert into current_incidents select user_id,'source_failed',count(*) from public.knowledge_source_tasks where state='failed' group by user_id;
 insert into current_incidents select user_id,'source_stalled',count(*) from public.knowledge_source_tasks where state in('queued','running') and available_at<now() and updated_at<now()-interval '30 minutes' group by user_id;
 update public.knowledge_incidents i set state='resolved',last_seen=now() where state='active' and not exists(select 1 from current_incidents c where c.user_id=i.user_id and c.code=i.code);
 insert into public.knowledge_incidents(user_id,code,state,affected) select user_id,code,'active',affected from current_incidents on conflict(user_id,code) do update set state='active',affected=excluded.affected,last_seen=now(),first_seen=case when knowledge_incidents.state='resolved' then now() else knowledge_incidents.first_seen end;
 get diagnostics changed=row_count;return changed;
end;$$;
