alter table public.bookmarks add column deleted_at timestamptz;
alter table public.bookmarks add column notes text not null default '';
alter table public.bookmarks add column user_edited_at timestamptz;

create table public.bookmark_sources (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null,
 bookmark_id uuid not null,
 source_hash text not null,
 source_url text not null,
 raw_content text not null,
 extracted_content text not null,
 media_type text not null default 'text/plain',
 truncated boolean not null default false,
 captured_at timestamptz not null default now(),
 foreign key(user_id,bookmark_id) references public.bookmarks(user_id,id) on delete cascade,
 unique(bookmark_id,source_hash)
);
create table public.bookmark_derivations (
 id uuid primary key default gen_random_uuid(),user_id uuid not null,bookmark_id uuid not null,
 source_hash text not null,provider text not null,model text not null,prompt_version text not null,
 summary text not null,tags text[] not null,evidence jsonb not null default '[]',created_at timestamptz not null default now(),
 foreign key(user_id,bookmark_id) references public.bookmarks(user_id,id) on delete cascade
);
create table public.bookmark_chunks (
 id uuid primary key default gen_random_uuid(),user_id uuid not null,bookmark_id uuid not null,
 source_hash text not null,ordinal integer not null,content text not null,
 embedding extensions.vector(1536),
 foreign key(user_id,bookmark_id) references public.bookmarks(user_id,id) on delete cascade,
 unique(bookmark_id,ordinal)
);
create table public.bookmark_jobs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null,bookmark_id uuid not null unique,
 state text not null default 'queued' check(state in ('queued','running','waiting','complete','failed','limited','cancelled')),
 stage text not null default 'extract' check(stage in ('extract','organize','index','complete')),
 attempts integer not null default 0,max_attempts integer not null default 4,
 available_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,
 error_code text,error_message text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(user_id,bookmark_id) references public.bookmarks(user_id,id) on delete cascade
);
create index bookmark_jobs_due on public.bookmark_jobs(state,available_at);
create index bookmark_sources_owner on public.bookmark_sources(user_id,bookmark_id);
create index bookmark_derivations_owner on public.bookmark_derivations(user_id,bookmark_id);
create index bookmark_chunks_owner on public.bookmark_chunks(user_id,bookmark_id);

alter table public.bookmark_sources enable row level security;
alter table public.bookmark_derivations enable row level security;
alter table public.bookmark_chunks enable row level security;
alter table public.bookmark_jobs enable row level security;
create policy own_sources on public.bookmark_sources for select to authenticated using(user_id=(select auth.uid()));
create policy own_derivations on public.bookmark_derivations for select to authenticated using(user_id=(select auth.uid()));
create policy own_chunks on public.bookmark_chunks for select to authenticated using(user_id=(select auth.uid()));
create policy own_jobs on public.bookmark_jobs for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.bookmark_sources,public.bookmark_derivations,public.bookmark_chunks,public.bookmark_jobs from public,anon,authenticated;
grant select on public.bookmark_sources,public.bookmark_derivations,public.bookmark_chunks,public.bookmark_jobs to authenticated;
grant all on public.bookmark_sources,public.bookmark_derivations,public.bookmark_chunks,public.bookmark_jobs to service_role;

-- A narrow trigger persists work atomically with the bookmark. No browser or page view is needed.
create schema if not exists internal;
revoke all on schema internal from public,anon,authenticated;
create function internal.enqueue_bookmark() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.bookmark_jobs(user_id,bookmark_id) values(new.user_id,new.id) on conflict(bookmark_id) do nothing;
 return new;
end;
$$;
revoke all on function internal.enqueue_bookmark() from public,anon,authenticated;
create trigger bookmark_enqueue after insert on public.bookmarks for each row execute function internal.enqueue_bookmark();
insert into public.bookmark_jobs(user_id,bookmark_id) select user_id,id from public.bookmarks on conflict do nothing;

create function public.claim_bookmark_jobs(owner_id uuid default null,batch_size integer default 3)
returns setof public.bookmark_jobs language sql security invoker set search_path=public as $$
 update public.bookmark_jobs set state='failed',error_code='worker_interrupted',error_message='处理多次中断，请手动重试',updated_at=now() where state='running' and lease_until<now() and attempts>=max_attempts;
 with due as (
  select j.id from public.bookmark_jobs j join public.bookmarks b on b.id=j.bookmark_id
  where b.deleted_at is null and (owner_id is null or j.user_id=owner_id) and j.attempts<j.max_attempts
    and ((j.state in ('queued','waiting') and j.available_at<=now()) or (j.state='running' and j.lease_until<now()))
  order by j.available_at,j.created_at limit greatest(1,least(batch_size,3)) for update of j skip locked
 ) update public.bookmark_jobs j set state='running',attempts=attempts+1,lease_until=now()+interval '5 minutes',
 lease_token=gen_random_uuid(),updated_at=now() from due where j.id=due.id returning j.*;
$$;
revoke all on function public.claim_bookmark_jobs(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_bookmark_jobs(uuid,integer) to service_role;

create function public.retry_own_bookmark(bookmark_id uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not exists(select 1 from public.bookmarks b where b.id=bookmark_id and b.user_id=auth.uid() and b.deleted_at is null) then return false;end if;
 update public.bookmark_jobs j set state='queued',attempts=0,available_at=now(),error_code=null,error_message=null,updated_at=now()
 where j.bookmark_id=retry_own_bookmark.bookmark_id and (state<>'running' or lease_until<now());
 return found;
end;
$$;
revoke all on function public.retry_own_bookmark(uuid) from public,anon;
grant execute on function public.retry_own_bookmark(uuid) to authenticated;

-- User-scoped hybrid retrieval returns source chunks so answers can cite exact evidence.
create function public.retrieve_knowledge(query_text text,query_embedding extensions.vector default null)
returns table(chunk_id uuid,bookmark_id uuid,title text,url text,content text,score double precision)
language sql stable security invoker set search_path=public,extensions as $$
 with terms as(select array_agg(t) words from regexp_split_to_table(lower(left(query_text,240)),'[[:space:][:punct:]]+') t where length(t)>1),
 ranked as(select c.id chunk_id,b.id bookmark_id,b.title,coalesce(b.final_url,b.original_url) url,c.content,
 (coalesce(1-(coalesce(c.embedding,b.embedding) <=> query_embedding),0)+(select count(*)*.2 from unnest(t.words) word where strpos(lower(b.title||' '||c.content||' '||array_to_string(b.tags,' ')),word)>0))::double precision score
 from public.bookmark_chunks c join public.bookmarks b on b.id=c.bookmark_id cross join terms t
 where c.user_id=(select auth.uid()) and b.deleted_at is null and c.source_hash=b.source_hash)
 select * from ranked where score>=.2 order by score desc,chunk_id limit 8;
$$;
revoke all on function public.retrieve_knowledge(text,extensions.vector) from public,anon;
grant execute on function public.retrieve_knowledge(text,extensions.vector) to authenticated;

-- Persist tag relationships without pretending that tags are vector similarities.
alter table public.bookmark_edges add column kind text not null default 'semantic' check(kind in ('tag','semantic'));
create function public.refresh_tag_edges(owner_id uuid) returns void language sql security invoker set search_path=public as $$
 delete from public.bookmark_edges where user_id=owner_id and kind='tag';
 insert into public.bookmark_edges(user_id,source_id,target_id,score,kind)
 select distinct owner_id,least(a.id,b.id),greatest(a.id,b.id),.43,'tag' from public.bookmarks a cross join lateral (
 select other.id from public.bookmarks other where other.user_id=owner_id and other.id<>a.id and other.deleted_at is null and a.tags&&other.tags
 order by (select count(*) from unnest(other.tags) tag where tag=any(a.tags)) desc,other.created_at desc,other.id limit 3
 ) b where a.user_id=owner_id and a.deleted_at is null and cardinality(a.tags)>0
 on conflict(user_id,source_id,target_id) do nothing;
$$;
revoke all on function public.refresh_tag_edges(uuid) from public,anon,authenticated;
grant execute on function public.refresh_tag_edges(uuid) to service_role;

-- Source retention for previously captured material; this is extracted text, not a fabricated original HTML.
insert into public.bookmark_sources(user_id,bookmark_id,source_hash,source_url,raw_content,extracted_content)
 select user_id,id,source_hash,coalesce(final_url,original_url),content,content from public.bookmarks
 where source_hash is not null and content is not null on conflict do nothing;

create function public.index_owned_bookmark(bookmark_id uuid,expected_hash text,new_embedding extensions.vector)
returns void language plpgsql security invoker set search_path=public,extensions as $$
declare owner_id uuid;
begin
 select b.user_id into owner_id from public.bookmarks b where b.id=bookmark_id and b.source_hash=expected_hash and b.deleted_at is null;
 if owner_id is null then return;end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 update public.bookmarks set embedding=new_embedding,status='indexed' where id=bookmark_id and source_hash=expected_hash;
 delete from public.bookmark_edges where user_id=owner_id and kind='semantic' and (source_id=bookmark_id or target_id=bookmark_id);
 insert into public.bookmark_edges(user_id,source_id,target_id,score,kind)
 select owner_id,least(bookmark_id,id),greatest(bookmark_id,id),similarity,'semantic' from (
 select b.id,1-(b.embedding <=> new_embedding) similarity from public.bookmarks b
 where b.user_id=owner_id and b.id<>bookmark_id and b.deleted_at is null and b.embedding is not null
 order by b.embedding <=> new_embedding limit 6) ranked where similarity>=.48
 on conflict(user_id,source_id,target_id) do update set score=excluded.score,kind='semantic';
end;
$$;
revoke all on function public.index_owned_bookmark(uuid,text,extensions.vector) from public,anon,authenticated;
grant execute on function public.index_owned_bookmark(uuid,text,extensions.vector) to service_role;
grant usage on schema extensions to service_role;
alter table public.bookmarks add column tags_edited_at timestamptz;
alter table public.bookmarks add column title_edited_at timestamptz;
alter table public.bookmark_sources add column origin text not null default 'web' check(origin in ('web','import','legacy'));
update public.bookmark_sources set origin='legacy' where media_type='text/plain';

grant select,insert,update,delete on public.bookmarks,public.bookmark_edges to service_role;

create or replace function public.search_bookmarks(query_text text, query_embedding extensions.vector default null)
returns table(id uuid) language sql stable security invoker set search_path = public, extensions as $$
  with query as (
    select array_agg(distinct piece) as terms
    from regexp_split_to_table(lower(left(query_text, 240)), '[[:space:][:punct:]]+') piece
    where length(piece) > 1
  ), scored as (
    select b.id, b.created_at,
      coalesce(1 - (b.embedding <=> query_embedding), 0) as similarity,
      (select count(*) from unnest(q.terms) term where strpos(
        lower(concat_ws(' ', b.title, b.summary, b.ai_summary, array_to_string(b.tags, ' '),
          b.canonical_url, b.content, b.notes)), term) > 0) as hits
    from public.bookmarks b cross join query q where b.user_id = auth.uid() and b.deleted_at is null
  )
  select s.id from scored s where s.hits > 0 or s.similarity >= 0.28
  order by (s.similarity + least(s.hits, 5) * 0.18) desc, s.created_at desc limit 60;
$$;


create table internal.knowledge_limits(user_id uuid not null,action text not null,window_start timestamptz not null,requests integer not null,primary key(user_id,action,window_start));
alter table internal.knowledge_limits enable row level security;
revoke all on internal.knowledge_limits from public,anon,authenticated;
create function public.consume_knowledge_quota(action_key text) returns boolean language plpgsql security definer set search_path=internal,pg_temp as $$
declare owner uuid:=auth.uid();budget integer;used integer;bucket timestamptz;
begin
 if owner is null then return false;end if;
 if action_key='answer' then budget:=20;bucket:=date_trunc('hour',now());
 elsif action_key='import' then budget:=500;bucket:=date_trunc('day',now());
 elsif action_key='capture' then budget:=200;bucket:=date_trunc('day',now());
 else return false;end if;
 insert into internal.knowledge_limits(user_id,action,window_start,requests) values(owner,action_key,bucket,1)
 on conflict(user_id,action,window_start) do update set requests=internal.knowledge_limits.requests+1 where internal.knowledge_limits.requests<budget returning requests into used;
 return used is not null;
end;
$$;
revoke all on function public.consume_knowledge_quota(text) from public,anon;
grant execute on function public.consume_knowledge_quota(text) to authenticated;
alter table public.bookmark_derivations add column origin text not null default 'model' check(origin in ('model','import'));
