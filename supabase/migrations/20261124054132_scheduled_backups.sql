-- Immutable logical snapshots. One INSERT statement observes one MVCC snapshot.
create table public.knowledge_backups(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 day date not null default current_date,state text not null default 'queued' check(state in('queued','running','complete','failed')),
 cursor bigint not null default 0,lease_until timestamptz,lease_token uuid,attempts integer not null default 0,
 manifest jsonb not null default '[]',error_message text,offsite boolean not null default false,
 created_at timestamptz not null default now(),completed_at timestamptz,verified_at timestamptz,expires_at timestamptz not null default now()+interval '7 days',unique(user_id,day)
);
create table public.knowledge_backup_rows(
 id bigint generated always as identity primary key,backup_id uuid not null references public.knowledge_backups(id) on delete cascade,
 table_name text not null,payload jsonb not null
);
create index backup_rows_cursor on public.knowledge_backup_rows(backup_id,id);
create table public.knowledge_backup_gc(id uuid primary key default gen_random_uuid(),prefix text not null unique,offsite boolean not null,created_at timestamptz not null default now());
alter table public.knowledge_backups enable row level security;
alter table public.knowledge_backup_rows enable row level security;
alter table public.knowledge_backup_gc enable row level security;
create policy owner_backup on public.knowledge_backups for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.knowledge_backups,public.knowledge_backup_rows,public.knowledge_backup_gc from public,anon,authenticated;
grant select on public.knowledge_backups to authenticated;
grant all on public.knowledge_backups,public.knowledge_backup_rows,public.knowledge_backup_gc to service_role;
grant usage,select on sequence public.knowledge_backup_rows_id_seq to service_role;
create function public.enqueue_knowledge_backup(owner_id uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
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
select result,'bookmark_relation_analyses',to_jsonb(t) from public.bookmark_relation_analyses t where t.user_id=owner_id;
 return result;
end;
$$;
revoke all on function public.enqueue_knowledge_backup(uuid) from public,anon,authenticated;
grant execute on function public.enqueue_knowledge_backup(uuid) to service_role;
create function public.claim_knowledge_backup() returns setof public.knowledge_backups language plpgsql security definer set search_path=public,pg_temp as $$
declare chosen uuid;
begin
 select id into chosen from public.knowledge_backups where state in('queued','running') and (lease_until is null or lease_until<now()) and attempts<6 order by created_at for update skip locked limit 1;
 if chosen is null then return;end if;
 return query update public.knowledge_backups set state='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=chosen returning *;
end;
$$;
revoke all on function public.claim_knowledge_backup() from public,anon,authenticated;
grant execute on function public.claim_knowledge_backup() to service_role;
create function public.backup_deleted_gc() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
 insert into public.knowledge_backup_gc(prefix,offsite) values(old.user_id::text||'/'||old.id::text||'/',old.offsite) on conflict(prefix) do update set offsite=knowledge_backup_gc.offsite or excluded.offsite;return old;
end;$$;
revoke all on function public.backup_deleted_gc() from public,anon,authenticated;
create trigger backup_delete_gc after delete on public.knowledge_backups for each row execute function public.backup_deleted_gc();
create index backup_owner_created on public.knowledge_backups(user_id,created_at desc);
create index backup_due on public.knowledge_backups(state,lease_until,created_at) where state in('queued','running');
create table public.knowledge_backup_artifacts(
 backup_id uuid not null references public.knowledge_backups(id) on delete cascade,key text not null,
 sha256 text not null,bytes bigint not null,primary key(backup_id,key)
);
alter table public.knowledge_backup_artifacts enable row level security;
revoke all on public.knowledge_backup_artifacts from public,anon,authenticated;
grant all on public.knowledge_backup_artifacts to service_role;
create function public.enqueue_due_knowledge_backups() returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid;counted integer:=0;
begin
 for owner in select distinct b.user_id from public.bookmarks b where not exists(select 1 from public.knowledge_backups k where k.user_id=b.user_id and k.day=current_date) limit 50 loop
 perform public.enqueue_knowledge_backup(owner);counted:=counted+1;end loop;return counted;
end;$$;
revoke all on function public.enqueue_due_knowledge_backups() from public,anon,authenticated;
grant execute on function public.enqueue_due_knowledge_backups() to service_role;
create or replace function public.asset_paths_in_use(paths text[]) returns table(object_path text) language sql stable security invoker set search_path=public as $$
 select a.object_path from public.bookmark_assets a where a.object_path=any(paths)
 union select path from unnest(paths) path where exists(select 1 from public.bookmark_assets a where a.parts@>jsonb_build_array(jsonb_build_object('path',path)))
 union select s.object_path from public.knowledge_asset_steps s where s.object_path=any(paths)
 union select path from unnest(paths) path where split_part(path,'/',2)='uploads' and exists(select 1 from public.knowledge_uploads u where u.user_id::text=split_part(path,'/',1) and u.id::text=split_part(path,'/',3) and u.state='uploading' and u.expires_at>now())
 union select path from unnest(paths) path where exists(select 1 from public.knowledge_backup_rows r where r.table_name='bookmark_assets' and (r.payload->>'object_path'=path or r.payload->'parts'@>jsonb_build_array(jsonb_build_object('path',path))));
$$;
create index backup_row_originals on public.knowledge_backup_rows using gin(payload jsonb_path_ops) where table_name='bookmark_assets';
-- Restore staging is service-only. Atomic commit prevents workers observing a partial library.
create table public.knowledge_restore_sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null default now());
create table public.knowledge_restore_rows(session_id uuid not null references public.knowledge_restore_sessions(id) on delete cascade,ordinal integer not null,table_name text not null,payload jsonb not null,primary key(session_id,ordinal));
alter table public.knowledge_restore_sessions enable row level security;
alter table public.knowledge_restore_rows enable row level security;
revoke all on public.knowledge_restore_sessions,public.knowledge_restore_rows from public,anon,authenticated;
grant all on public.knowledge_restore_sessions,public.knowledge_restore_rows to service_role;
create function public.commit_knowledge_restore(restore_id uuid) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid;tbl text;cols text;row_count integer:=0;added integer;
begin
 select user_id into owner from public.knowledge_restore_sessions where id=restore_id for update;
 if owner is null then raise exception 'Restore session missing';end if;
 perform pg_advisory_xact_lock(hashtextextended('restore:'||owner::text,0));
 if exists(select 1 from public.bookmarks where user_id=owner) then raise exception 'Restore target must be empty';end if;
 if exists(select 1 from public.knowledge_restore_rows where session_id=restore_id and (payload->>'user_id' is distinct from owner::text or table_name not in('bookmarks','bookmark_sources','bookmark_derivations','bookmark_chunks','bookmark_piece_summaries','bookmark_edges','bookmark_assets','knowledge_insights','knowledge_entities','knowledge_entity_revisions','knowledge_entity_updates','bookmark_relation_analyses'))) then raise exception 'Invalid restore scope';end if;
 foreach tbl in array array['bookmarks','bookmark_sources','bookmark_derivations','bookmark_chunks','bookmark_piece_summaries','bookmark_edges','bookmark_assets','knowledge_insights','knowledge_entities','knowledge_entity_revisions','knowledge_entity_updates','bookmark_relation_analyses'] loop
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
 delete from public.knowledge_restore_sessions where id=restore_id;return row_count;
end;$$;
revoke all on function public.commit_knowledge_restore(uuid) from public,anon,authenticated;
grant execute on function public.commit_knowledge_restore(uuid) to service_role;
