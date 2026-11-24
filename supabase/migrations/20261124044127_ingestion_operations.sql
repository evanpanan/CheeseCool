alter table public.bookmark_assets drop constraint bookmark_assets_bytes_check;
alter table public.bookmark_assets add constraint bookmark_assets_bytes_check check(bytes>0 and bytes<=200000000);
alter table public.bookmark_assets add column parts jsonb not null default '[]';
alter table public.bookmark_assets add column integrity_kind text not null default 'sha256' check(integrity_kind in ('sha256','chunk_manifest'));

create table public.knowledge_uploads(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 filename text not null,media_type text not null,diarize boolean not null default true,record_kind text not null check(record_kind in ('document','audio','video')),
 bytes integer not null check(bytes>0 and bytes<=200000000),parts jsonb not null default '[]',
 state text not null default 'uploading' check(state in ('uploading','complete','cancelled')),bookmark_id uuid references public.bookmarks(id) on delete set null,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '24 hours'
);
alter table public.knowledge_uploads enable row level security;
create policy own_uploads on public.knowledge_uploads for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.knowledge_uploads from public,anon,authenticated;
grant select on public.knowledge_uploads to authenticated;
grant all on public.knowledge_uploads to service_role;
create index knowledge_uploads_owner on public.knowledge_uploads(user_id,state,expires_at);

create function public.register_knowledge_upload_part(upload_id uuid,part_number integer,part_hash text) returns jsonb
language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare owner uuid:=auth.uid();u public.knowledge_uploads;path text;expected integer;entry jsonb;
begin
 if owner is null then raise exception 'authentication required';end if;
 select * into u from public.knowledge_uploads where id=upload_id and user_id=owner and state='uploading' and expires_at>now() for update;
 if not found then raise exception 'upload unavailable';end if;
 if part_number<0 or part_number>=ceil(u.bytes/8388608.0)::int or part_hash!~'^[a-f0-9]{64}$' then raise exception 'invalid part';end if;
 path:=owner::text||'/uploads/'||u.id::text||'/'||part_number::text;
 expected:=least(8388608,u.bytes-part_number*8388608);
 if not exists(select 1 from storage.objects o where o.bucket_id='knowledge-originals' and o.name=path and (o.metadata->>'size')::bigint=expected) then raise exception 'part not uploaded';end if;
 entry:=jsonb_build_object('ordinal',part_number,'path',path,'bytes',expected,'sha256',part_hash);
 update public.knowledge_uploads set parts=(select coalesce(jsonb_agg(p order by (p->>'ordinal')::int),'[]') from (select p from jsonb_array_elements(u.parts) p where (p->>'ordinal')::int<>part_number union all select entry) x) where id=u.id;
 return entry;
end;
$$;
revoke all on function public.register_knowledge_upload_part(uuid,integer,text) from public,anon;
grant execute on function public.register_knowledge_upload_part(uuid,integer,text) to authenticated;

create function public.finalize_knowledge_upload(upload_id uuid,manifest_hash text) returns uuid
language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare owner uuid:=auth.uid();u public.knowledge_uploads;record uuid;item jsonb;
begin
 if owner is null then raise exception 'authentication required';end if;
 select * into u from public.knowledge_uploads where id=upload_id and user_id=owner for update;
 if not found then raise exception 'upload unavailable';end if;
 if u.state='complete' then return u.bookmark_id;end if;
 if u.state<>'uploading' or u.expires_at<=now() or manifest_hash!~'^[a-f0-9]{64}$' then raise exception 'upload unavailable';end if;
 if jsonb_array_length(u.parts)<>ceil(u.bytes/8388608.0)::int then raise exception 'upload incomplete';end if;
 for item in select * from jsonb_array_elements(u.parts) loop
  if not exists(select 1 from storage.objects o where o.bucket_id='knowledge-originals' and o.name=item->>'path' and (o.metadata->>'size')::bigint=(item->>'bytes')::bigint) then raise exception 'part missing';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,0));
 if (select coalesce(sum(bytes),0) from public.bookmark_assets where user_id=owner)+u.bytes>500000000 then raise exception 'original storage quota reached';end if;
 record:=public.create_knowledge_record(u.record_kind,u.filename,'','',jsonb_build_object('filename',u.filename,'size',u.bytes,'upload_id',u.id,'diarize',u.diarize));
 insert into public.bookmark_assets(user_id,bookmark_id,object_path,filename,media_type,sha256,bytes,parts,integrity_kind)
 values(owner,record,u.parts->0->>'path',u.filename,u.media_type,manifest_hash,u.bytes,u.parts,'chunk_manifest');
 delete from public.bookmark_asset_gc where object_path in(select p->>'path' from jsonb_array_elements(u.parts) p);
 update public.knowledge_uploads set state='complete',bookmark_id=record where id=u.id;
 return record;
end;
$$;
revoke all on function public.finalize_knowledge_upload(uuid,text) from public,anon;
grant execute on function public.finalize_knowledge_upload(uuid,text) to authenticated;

create table public.knowledge_asset_steps(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,bookmark_id uuid not null,asset_id uuid not null references public.bookmark_assets(id) on delete cascade,
 kind text not null check(kind in ('transcript','ocr')),ordinal integer not null,start_seconds double precision,duration_seconds double precision,
 object_path text,sha256 text,bytes integer,text text,segments jsonb not null default '[]',state text not null default 'pending' check(state in ('pending','prepared','complete')),
 provider text not null default 'openai',model text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(user_id,bookmark_id) references public.bookmarks(user_id,id) on delete cascade,unique(asset_id,kind,ordinal)
);
alter table public.knowledge_asset_steps enable row level security;
create policy own_asset_steps on public.knowledge_asset_steps for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.knowledge_asset_steps from public,anon,authenticated;
grant select on public.knowledge_asset_steps to authenticated;
grant all on public.knowledge_asset_steps to service_role;
create index knowledge_asset_steps_owner on public.knowledge_asset_steps(user_id,asset_id,kind,state);

create or replace function internal.collect_removed_asset() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.bookmark_asset_gc(object_path) values(old.object_path) on conflict do nothing;
 insert into public.bookmark_asset_gc(object_path) select p->>'path' from jsonb_array_elements(old.parts) p on conflict do nothing;
 return old;
end;
$$;
create function internal.collect_removed_step() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.object_path is not null then insert into public.bookmark_asset_gc(object_path) values(old.object_path) on conflict do nothing;end if;return old;
end;
$$;
revoke all on function internal.collect_removed_step() from public,anon,authenticated;
create trigger knowledge_step_removed after delete on public.knowledge_asset_steps for each row execute function internal.collect_removed_step();

create function public.asset_paths_in_use(paths text[]) returns table(object_path text) language sql stable security invoker set search_path=public as $$
 select a.object_path from public.bookmark_assets a where a.object_path=any(paths)
 union select p->>'path' from public.bookmark_assets a cross join lateral jsonb_array_elements(a.parts) p where p->>'path'=any(paths)
 union select s.object_path from public.knowledge_asset_steps s where s.object_path=any(paths)
 union select u.user_id::text||'/uploads/'||u.id::text||'/'||i::text from public.knowledge_uploads u cross join lateral generate_series(0,ceil(u.bytes/8388608.0)::int-1) i where u.state='uploading' and u.expires_at>now() and u.user_id::text||'/uploads/'||u.id::text||'/'||i::text=any(paths);
$$;
revoke all on function public.asset_paths_in_use(text[]) from public,anon,authenticated;
grant execute on function public.asset_paths_in_use(text[]) to service_role;

create table public.knowledge_job_events(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,bookmark_id uuid references public.bookmarks(id) on delete cascade,
 state text not null,stage text not null,error_code text,duration_ms integer not null,attempt integer not null,created_at timestamptz not null default now()
);
alter table public.knowledge_job_events enable row level security;
create policy own_job_events on public.knowledge_job_events for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.knowledge_job_events from public,anon,authenticated;
grant select on public.knowledge_job_events to authenticated;
grant all on public.knowledge_job_events to service_role;
create index knowledge_job_events_owner on public.knowledge_job_events(user_id,created_at desc);
delete from internal.knowledge_limits k where not exists(select 1 from auth.users u where u.id=k.user_id);
alter table internal.knowledge_limits add foreign key(user_id) references auth.users(id) on delete cascade;

alter table public.bookmark_sources drop constraint bookmark_sources_origin_check;
alter table public.bookmark_sources add constraint bookmark_sources_origin_check check(origin in ('web','import','legacy','user','browser'));
create function public.capture_browser_document(source_url text,canonical text,source_title text,source_text text,source_html text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid:=auth.uid();record uuid;hash text;
begin
 if owner is null then raise exception 'authentication required';end if;
 if source_url!~'^https?://' or canonical!~'^https?://' or length(source_url)>8000 or length(canonical)>8000 or length(source_text)<8 or length(source_text)>500000 or octet_length(source_html)>1500000 then raise exception 'invalid capture';end if;
 if not public.consume_knowledge_quota('capture') then raise exception 'capture quota exhausted';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,0));
 select id into record from public.bookmarks where user_id=owner and canonical_url=canonical;
 if record is not null and exists(select 1 from public.bookmark_jobs where bookmark_id=record and state='running' and lease_until>now()) then raise exception 'capture processing in progress';end if;
 hash:=encode(sha256(convert_to(source_text,'UTF8')),'hex');
 if record is null then
  insert into public.bookmarks(user_id,original_url,canonical_url,platform,title,content,source_hash,status,attributes)
  values(owner,source_url,canonical,'web',left(source_title,240),source_text,hash,'extracted',jsonb_build_object('capture_level','browser_readable','capture_origin','browser')) returning id into record;
 else
  update public.bookmarks set content=source_text,source_hash=hash,ai_summary=null,embedding=null,status='extracted',deleted_at=null,title=case when title_edited_at is null then left(source_title,240) else title end,attributes=attributes||jsonb_build_object('capture_level','browser_readable','capture_origin','browser') where id=record and user_id=owner;
 end if;
 insert into public.bookmark_sources(user_id,bookmark_id,source_hash,source_url,raw_content,extracted_content,media_type,origin,metadata)
 values(owner,record,hash,source_url,source_html,source_text,'text/html','browser',jsonb_build_object('title',source_title,'capture_level','browser_readable','scope','content visible to the user agent at capture time')) on conflict(bookmark_id,source_hash) do nothing;
 perform public.retry_own_bookmark(record);
 return record;
end;
$$;
revoke all on function public.capture_browser_document(text,text,text,text,text) from public,anon;
grant execute on function public.capture_browser_document(text,text,text,text,text) to authenticated;

create function public.create_knowledge_upload(file_name text,file_bytes integer,file_type text,record_kind text,want_diarization boolean default true) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid:=auth.uid();upload uuid;ext text;
begin
 if owner is null then raise exception 'authentication required';end if;
 ext:=lower(substring(file_name from '\.([^.]+)$'));
 if file_bytes<=0 or file_bytes>200000000 or length(file_name)<1 or length(file_name)>240 or length(file_type)>160 or record_kind not in ('audio','video','document') or ext not in ('pdf','docx','txt','md','csv','json','mp3','wav','m4a','ogg','flac','aac','opus','mpga','mp4','webm','mov','mkv','mpeg','mpg') then raise exception 'invalid upload';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,0));
 if (select count(*) from public.knowledge_uploads where user_id=owner and state='uploading' and expires_at>now())>=4 or (select coalesce(sum(bytes),0) from public.bookmark_assets where user_id=owner)+(select coalesce(sum(bytes),0) from public.knowledge_uploads where user_id=owner and state='uploading' and expires_at>now())+file_bytes>500000000 then raise exception 'upload quota exceeded';end if;
 insert into public.knowledge_uploads(user_id,filename,bytes,media_type,record_kind,diarize) values(owner,file_name,file_bytes,file_type,record_kind,want_diarization) returning id into upload;
 insert into public.bookmark_asset_gc(object_path,available_at) select owner::text||'/uploads/'||upload::text||'/'||i,now()+interval '24 hours' from generate_series(0,ceil(file_bytes/8388608.0)::int-1) i;
 return upload;
end;
$$;
revoke all on function public.create_knowledge_upload(text,integer,text,text,boolean) from public,anon;
grant execute on function public.create_knowledge_upload(text,integer,text,text,boolean) to authenticated;
create index bookmark_asset_parts on public.bookmark_assets using gin(parts jsonb_path_ops);
create index knowledge_step_path on public.knowledge_asset_steps(object_path) where object_path is not null;
create or replace function public.asset_paths_in_use(paths text[]) returns table(object_path text) language sql stable security invoker set search_path=public as $$
 select a.object_path from public.bookmark_assets a where a.object_path=any(paths)
 union select path from unnest(paths) path where exists(select 1 from public.bookmark_assets a where a.parts@>jsonb_build_array(jsonb_build_object('path',path)))
 union select s.object_path from public.knowledge_asset_steps s where s.object_path=any(paths)
 union select path from unnest(paths) path where split_part(path,'/',2)='uploads' and exists(select 1 from public.knowledge_uploads u where u.user_id::text=split_part(path,'/',1) and u.id::text=split_part(path,'/',3) and u.state='uploading' and u.expires_at>now());
$$;
