alter table public.bookmarks add column record_type text not null default 'web' check(record_type in ('web','note','journal','ai_conversation','meeting','knowledge_note','document','audio','video'));
alter table public.bookmarks add column attributes jsonb not null default '{}';
alter table public.bookmark_sources add column metadata jsonb not null default '{}';
alter table public.bookmark_sources drop constraint bookmark_sources_origin_check;
alter table public.bookmark_sources add constraint bookmark_sources_origin_check check(origin in ('web','import','legacy','user'));

create function public.create_knowledge_record(record_kind text,record_title text,record_content text,record_raw text,record_attributes jsonb default '{}')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid();new_id uuid:=gen_random_uuid();link text;hash text;
begin
 if owner_id is null then raise exception 'Authentication required';end if;
 if record_kind not in ('note','journal','ai_conversation','meeting','knowledge_note','document','audio','video') or (length(record_content)<1 and record_kind not in ('document','audio','video')) or length(record_content)>500000 or octet_length(record_raw)>1800000 or octet_length(record_attributes::text)>10000 then raise exception 'Invalid record';end if;
 if not public.consume_knowledge_quota('capture') then raise exception 'Capture quota exhausted';end if;
 link:='https://cheese-cool.vercel.app/document/'||new_id::text;
 hash:=encode(sha256(convert_to(record_content,'UTF8')),'hex');
 insert into public.bookmarks(id,user_id,original_url,canonical_url,platform,title,content,source_hash,status,record_type,attributes)
 values(new_id,owner_id,link,link,'web',left(record_title,240),nullif(record_content,''),case when record_content='' then null else hash end,case when record_content='' then 'saved' else 'extracted' end,record_kind,record_attributes);
 if record_content<>'' then
 insert into public.bookmark_sources(user_id,bookmark_id,source_hash,source_url,raw_content,extracted_content,media_type,origin,metadata)
 values(owner_id,new_id,hash,link,record_raw,record_content,'text/plain','user',jsonb_build_object('title',record_title,'record_type',record_kind,'attributes',record_attributes));
 end if;
 return new_id;
end;
$$;
revoke all on function public.create_knowledge_record(text,text,text,text,jsonb) from public,anon;
grant execute on function public.create_knowledge_record(text,text,text,text,jsonb) to authenticated;

create table public.knowledge_insights(
 id uuid primary key default gen_random_uuid(),user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null,body text not null,source_ids uuid[] not null,evidence jsonb not null default '[]',entities jsonb not null default '[]',
 provider text not null,model text not null,state text not null default 'draft' check(state in ('draft','confirmed','rejected')),
 created_at timestamptz not null default now(),confirmed_at timestamptz,published_bookmark_id uuid references public.bookmarks(id) on delete set null
);
alter table public.knowledge_insights enable row level security;
create policy own_insights on public.knowledge_insights to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.knowledge_insights from public,anon,authenticated;
grant select on public.knowledge_insights to authenticated;
grant all on public.knowledge_insights to service_role;
create table public.knowledge_entities(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 name text not null,kind text not null check(kind in ('person','organization','project','concept')),description text not null,
 source_ids uuid[] not null,confirmed_at timestamptz not null default now(),unique(user_id,name,kind)
);
alter table public.knowledge_entities enable row level security;
create policy own_entities on public.knowledge_entities for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.knowledge_entities from public,anon,authenticated;
grant select on public.knowledge_entities to authenticated;
grant all on public.knowledge_entities to service_role;

create function public.confirm_knowledge_insight(insight_id uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid();draft public.knowledge_insights;record_id uuid;item jsonb;
begin
 if owner_id is null then return null;end if;
 select * into draft from public.knowledge_insights where id=insight_id and user_id=owner_id and state='draft' for update;
 if not found then return null;end if;
 if exists(select 1 from unnest(draft.source_ids) source_id where not exists(select 1 from public.bookmarks b where b.id=source_id and b.user_id=owner_id and b.deleted_at is null)) then return null;end if;
 if exists(select 1 from jsonb_array_elements(draft.evidence) e where not exists(select 1 from public.bookmarks b where b.id=(e->>'source_id')::uuid and b.source_hash=e->>'source_hash' and b.user_id=owner_id)) then return null;end if;
 record_id:=public.create_knowledge_record('knowledge_note',draft.title,draft.body,draft.body,jsonb_build_object('derived_from',draft.source_ids,'insight_id',draft.id,'provider',draft.provider,'model',draft.model,'confirmed_by',owner_id));
 update public.knowledge_insights set state='confirmed',confirmed_at=now(),published_bookmark_id=record_id where id=insight_id;
 for item in select * from jsonb_array_elements(draft.entities) loop
  insert into public.knowledge_entities(user_id,name,kind,description,source_ids)
  values(owner_id,item->>'name',item->>'kind',item->>'description',array[(item->>'source_id')::uuid])
  on conflict(user_id,name,kind) do update set description=excluded.description,source_ids=(select array_agg(distinct x) from unnest(knowledge_entities.source_ids||excluded.source_ids) x),confirmed_at=now();
 end loop;
 return record_id;
end;
$$;
revoke all on function public.confirm_knowledge_insight(uuid) from public,anon;
grant execute on function public.confirm_knowledge_insight(uuid) to authenticated;

create table public.bookmark_piece_summaries(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,bookmark_id uuid not null,source_hash text not null,ordinal integer not null,
 provider text not null,model text not null,prompt_version text not null,summary text not null,tags text[] not null,evidence jsonb not null default '[]',
 created_at timestamptz not null default now(),
 foreign key(user_id,bookmark_id) references public.bookmarks(user_id,id) on delete cascade,
 unique(bookmark_id,source_hash,ordinal,provider,model,prompt_version)
);
alter table public.bookmark_piece_summaries enable row level security;
create policy own_piece_summaries on public.bookmark_piece_summaries for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.bookmark_piece_summaries from public,anon,authenticated;
grant select on public.bookmark_piece_summaries to authenticated;
grant all on public.bookmark_piece_summaries to service_role;
create index bookmark_pieces_owner on public.bookmark_piece_summaries(user_id,bookmark_id);
alter table public.bookmark_derivations add column coverage jsonb not null default '{}';

create table public.bookmark_assets(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,bookmark_id uuid not null,
 object_path text not null unique,filename text not null,media_type text not null,sha256 text not null,bytes integer not null check(bytes>0 and bytes<=3000000),
 created_at timestamptz not null default now(),foreign key(user_id,bookmark_id) references public.bookmarks(user_id,id) on delete cascade,unique(bookmark_id,sha256)
);
alter table public.bookmark_assets enable row level security;
create policy own_assets on public.bookmark_assets for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.bookmark_assets from public,anon,authenticated;
grant select on public.bookmark_assets to authenticated;
grant all on public.bookmark_assets to service_role;
create index bookmark_assets_owner on public.bookmark_assets(user_id,bookmark_id);

create table public.bookmark_asset_gc(id uuid primary key default gen_random_uuid(),object_path text not null unique,created_at timestamptz not null default now(),available_at timestamptz not null default now());
alter table public.bookmark_asset_gc enable row level security;
revoke all on public.bookmark_asset_gc from public,anon,authenticated;
grant all on public.bookmark_asset_gc to service_role;
create function internal.collect_removed_asset() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.bookmark_asset_gc(object_path) values(old.object_path) on conflict do nothing;
 return old;
end;
$$;
revoke all on function internal.collect_removed_asset() from public,anon,authenticated;
create trigger bookmark_asset_removed after delete on public.bookmark_assets for each row execute function internal.collect_removed_asset();
