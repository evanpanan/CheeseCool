alter table public.knowledge_insights add column source_versions jsonb not null default '{}';
alter table public.knowledge_entities add column source_versions jsonb not null default '{}';
alter table public.knowledge_entities add column aliases text[] not null default '{}';
alter table public.knowledge_entities add column version integer not null default 1;
alter table public.knowledge_entities add column merged_into uuid references public.knowledge_entities(id) on delete set null;
create table public.knowledge_entity_revisions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,entity_id uuid not null references public.knowledge_entities(id) on delete cascade,
 before_data jsonb,after_data jsonb not null,reason text not null,created_at timestamptz not null default now()
);
alter table public.knowledge_entity_revisions enable row level security;
create policy own_entity_revisions on public.knowledge_entity_revisions for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.knowledge_entity_revisions from public,anon,authenticated;
grant select on public.knowledge_entity_revisions to authenticated;
grant all on public.knowledge_entity_revisions to service_role;
create index entity_revisions_owner on public.knowledge_entity_revisions(user_id,entity_id,created_at desc);
create table public.knowledge_entity_updates(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,entity_id uuid not null references public.knowledge_entities(id) on delete cascade,
 insight_id uuid references public.knowledge_insights(id) on delete set null,base_version integer not null,new_description text not null,source_ids uuid[] not null,source_versions jsonb not null default '{}',evidence jsonb not null,
 state text not null default 'pending' check(state in ('pending','accepted','rejected')),created_at timestamptz not null default now(),reviewed_at timestamptz,
 unique(entity_id,insight_id)
);
alter table public.knowledge_entity_updates enable row level security;
create policy own_entity_updates on public.knowledge_entity_updates for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.knowledge_entity_updates from public,anon,authenticated;
grant select on public.knowledge_entity_updates to authenticated;
grant all on public.knowledge_entity_updates to service_role;
create index entity_updates_owner on public.knowledge_entity_updates(user_id,state,created_at desc);
alter table public.bookmark_relation_analyses add column review_state text not null default 'pending' check(review_state in ('pending','confirmed','rejected'));
alter table public.bookmark_relation_analyses add column reviewed_at timestamptz;

create function public.merge_knowledge_entities(from_entity uuid,into_entity uuid,from_version integer,into_version integer) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid:=auth.uid();a public.knowledge_entities;b public.knowledge_entities;combined uuid[];names text[];
begin
 if owner is null or from_entity=into_entity then return null;end if;
 perform 1 from public.knowledge_entity_updates where entity_id in(from_entity,into_entity) and user_id=owner and state='pending' order by id for update;
 perform 1 from public.knowledge_entities where id in(from_entity,into_entity) and user_id=owner order by id for update;
 select * into a from public.knowledge_entities where id=from_entity and user_id=owner;
 select * into b from public.knowledge_entities where id=into_entity and user_id=owner;
 if a.id is null or b.id is null or a.merged_into is not null or b.merged_into is not null or a.kind<>b.kind or a.version<>from_version or b.version<>into_version then return null;end if;
 if exists(select 1 from unnest(a.source_ids||b.source_ids) source where not exists(select 1 from public.bookmarks x where x.id=source and x.user_id=owner and x.deleted_at is null)) then return null;end if;
 select array_agg(distinct x) into combined from unnest(a.source_ids||b.source_ids) x;
 select array_agg(distinct x) into names from unnest(a.aliases||b.aliases||array[a.name]) x where x<>b.name;
 insert into public.knowledge_entity_revisions(user_id,entity_id,before_data,after_data,reason) values(owner,b.id,to_jsonb(b),jsonb_build_object('merged_from',to_jsonb(a),'target_name',b.name,'aliases',names,'source_ids',combined),'user_confirmed_merge');
 update public.knowledge_entities set source_ids=combined,source_versions=a.source_versions||b.source_versions,aliases=coalesce(names,'{}'),version=version+1,confirmed_at=now() where id=b.id;
 -- Conflicting descriptions are retained for review, never silently replaced.
 if a.description<>b.description then
  insert into public.knowledge_entity_updates(user_id,entity_id,base_version,new_description,source_ids,source_versions,evidence)
  values(owner,b.id,b.version+1,a.description,a.source_ids,a.source_versions,'[]');
 end if;
 update public.knowledge_entity_updates set state='rejected',reviewed_at=now() where entity_id=a.id and state='pending';
 insert into public.knowledge_entity_revisions(user_id,entity_id,before_data,after_data,reason) select owner,e.id,to_jsonb(e),jsonb_build_object('merged_into',b.id),'user_confirmed_merge' from public.knowledge_entities e where e.user_id=owner and (e.id=a.id or e.merged_into=a.id);
 update public.knowledge_entities set merged_into=b.id,version=version+1 where user_id=owner and (id=a.id or merged_into=a.id);
 return b.id;
end;
$$;
revoke all on function public.merge_knowledge_entities(uuid,uuid,integer,integer) from public,anon;
grant execute on function public.merge_knowledge_entities(uuid,uuid,integer,integer) to authenticated;

create function public.review_entity_update(update_id uuid,accept_change boolean) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid:=auth.uid();proposal public.knowledge_entity_updates;entity public.knowledge_entities;merged uuid[];
begin
 if owner is null then return false;end if;
 select * into proposal from public.knowledge_entity_updates where id=update_id and user_id=owner and state='pending' for update;
 if not found then return false;end if;
 if not accept_change then update public.knowledge_entity_updates set state='rejected',reviewed_at=now() where id=proposal.id;return true;end if;
 select * into entity from public.knowledge_entities where id=proposal.entity_id and user_id=owner for update;
 if not found or entity.version<>proposal.base_version then return false;end if;
 if exists(select 1 from unnest(proposal.source_ids) source where not exists(select 1 from public.bookmarks b where b.id=source and b.user_id=owner and b.deleted_at is null)) then return false;end if;
 if exists(select 1 from jsonb_each_text(proposal.source_versions) e where not exists(select 1 from public.bookmarks b where b.id=e.key::uuid and b.user_id=owner and b.source_hash=e.value and b.deleted_at is null)) then return false;end if;
 if exists(select 1 from jsonb_array_elements(proposal.evidence) e where not exists(select 1 from public.bookmarks b where b.id=(e->>'source_id')::uuid and b.user_id=owner and b.deleted_at is null and b.source_hash=e->>'source_hash' and strpos(b.content,e->>'quote')>0)) then return false;end if;
 select array_agg(distinct x) into merged from unnest(entity.source_ids||proposal.source_ids)x;
 insert into public.knowledge_entity_revisions(user_id,entity_id,before_data,after_data,reason) values(owner,entity.id,to_jsonb(entity),jsonb_build_object('description',proposal.new_description,'source_ids',merged),'user_accepted_update');
 update public.knowledge_entities set description=proposal.new_description,source_ids=merged,source_versions=entity.source_versions||proposal.source_versions,version=version+1,confirmed_at=now() where id=entity.id;
 update public.knowledge_entity_updates set state='accepted',reviewed_at=now() where id=proposal.id;return true;
end;
$$;
revoke all on function public.review_entity_update(uuid,boolean) from public,anon;
grant execute on function public.review_entity_update(uuid,boolean) to authenticated;

create function public.review_knowledge_relation(analysis_id uuid,decision text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid:=auth.uid();analysis public.bookmark_relation_analyses;
begin
 if owner is null or decision not in ('confirmed','rejected') then return false;end if;
 select * into analysis from public.bookmark_relation_analyses where id=analysis_id and user_id=owner and review_state='pending' for update;
 if not found then return false;end if;
 if not exists(select 1 from public.bookmarks where id=analysis.source_id and user_id=owner and source_hash=analysis.source_hash and deleted_at is null) or not exists(select 1 from public.bookmarks where id=analysis.target_id and user_id=owner and source_hash=analysis.target_hash and deleted_at is null) then return false;end if;
 update public.bookmark_relation_analyses set review_state=decision,reviewed_at=now() where id=analysis.id;return true;
end;
$$;
revoke all on function public.review_knowledge_relation(uuid,text) from public,anon;
grant execute on function public.review_knowledge_relation(uuid,text) to authenticated;

create or replace function public.confirm_knowledge_insight(insight_id uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid();draft public.knowledge_insights;record_id uuid;item jsonb;existing_entity public.knowledge_entities;
begin
 if owner_id is null then return null;end if;
 select * into draft from public.knowledge_insights where id=insight_id and user_id=owner_id and state='draft' for update;
 if not found then return null;end if;
 if (select count(*) from jsonb_object_keys(draft.source_versions))<>cardinality(draft.source_ids) or exists(select 1 from unnest(draft.source_ids) sid where not exists(select 1 from public.bookmarks b where b.id=sid and b.user_id=owner_id and b.deleted_at is null and b.source_hash=draft.source_versions->>sid::text)) then return null;end if;
 if exists(select 1 from unnest(draft.source_ids) source_id where not exists(select 1 from public.bookmarks b where b.id=source_id and b.user_id=owner_id and b.deleted_at is null)) then return null;end if;
 if exists(select 1 from jsonb_array_elements(draft.evidence) e where not exists(select 1 from public.bookmarks b where b.id=(e->>'source_id')::uuid and b.source_hash=e->>'source_hash' and b.user_id=owner_id)) then return null;end if;
 record_id:=public.create_knowledge_record('knowledge_note',draft.title,draft.body,draft.body,jsonb_build_object('derived_from',draft.source_ids,'insight_id',draft.id,'provider',draft.provider,'model',draft.model,'confirmed_by',owner_id));
 update public.knowledge_insights set state='confirmed',confirmed_at=now(),published_bookmark_id=record_id where id=insight_id;
 for item in select * from jsonb_array_elements(draft.entities) loop
  select * into existing_entity from public.knowledge_entities where user_id=owner_id and name=item->>'name' and kind=item->>'kind' for update;
  if existing_entity.merged_into is not null then select * into existing_entity from public.knowledge_entities where id=existing_entity.merged_into and user_id=owner_id;end if;
  if existing_entity.id is null then
   insert into public.knowledge_entities(user_id,name,kind,description,source_ids,source_versions) values(owner_id,item->>'name',item->>'kind',item->>'description',array[(item->>'source_id')::uuid],jsonb_build_object(item->>'source_id',(select source_hash from public.bookmarks where id=(item->>'source_id')::uuid)));
  elsif existing_entity.description<>item->>'description' then
   insert into public.knowledge_entity_updates(user_id,entity_id,insight_id,base_version,new_description,source_ids,source_versions,evidence)
   values(owner_id,existing_entity.id,draft.id,existing_entity.version,item->>'description',array[(item->>'source_id')::uuid],jsonb_build_object(item->>'source_id',(select source_hash from public.bookmarks where id=(item->>'source_id')::uuid)),jsonb_build_array(jsonb_build_object('source_id',item->>'source_id','source_hash',(select source_hash from public.bookmarks where id=(item->>'source_id')::uuid),'quote',item->>'quote')))
   on conflict on constraint knowledge_entity_updates_entity_id_insight_id_key do nothing;
  else
   insert into public.knowledge_entity_revisions(user_id,entity_id,before_data,after_data,reason) values(owner_id,existing_entity.id,to_jsonb(existing_entity),jsonb_build_object('confirmed_source',item->>'source_id','source_hash',(select source_hash from public.bookmarks where id=(item->>'source_id')::uuid)),'user_confirmed_source');
   update public.knowledge_entities set source_ids=(select array_agg(distinct x) from unnest(knowledge_entities.source_ids||array[(item->>'source_id')::uuid])x),source_versions=source_versions||jsonb_build_object(item->>'source_id',(select source_hash from public.bookmarks where id=(item->>'source_id')::uuid)),version=version+1,confirmed_at=now() where id=existing_entity.id;
  end if;
 end loop;
 return record_id;
end;
$$;
revoke all on function public.confirm_knowledge_insight(uuid) from public,anon;
grant execute on function public.confirm_knowledge_insight(uuid) to authenticated;

