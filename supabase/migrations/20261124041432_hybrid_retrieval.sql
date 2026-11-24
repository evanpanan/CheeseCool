-- Rank lexical and semantic results independently before fusion. Every branch
-- remains SECURITY INVOKER and is limited to the caller's live source versions.
create function public.hybrid_knowledge_candidates(query_text text,query_embedding extensions.vector default null)
returns table(chunk_id uuid,bookmark_id uuid,title text,url text,content text,score double precision,source_hash text,lexical_rank bigint,semantic_rank bigint)
language sql stable security invoker set search_path=public,extensions as $$
 with terms as (
  select array_agg(distinct t) words from regexp_split_to_table(lower(left(query_text,240)),'[[:space:][:punct:]]+') t where length(t)>1
 ), eligible as (
  select c.id chunk_id,b.id bookmark_id,b.title,coalesce(b.final_url,b.original_url) url,c.content,b.source_hash,
   (select coalesce(sum(case when strpos(lower(c.content),word)>0 then 1.0 else 0 end + case when strpos(lower(b.title),word)>0 then 2.0 else 0 end + case when strpos(lower(array_to_string(b.tags,' ')),word)>0 then 1.5 else 0 end),0) from unnest(t.words) word)::double precision hits,
   (1-(coalesce(c.embedding,b.embedding) <=> query_embedding))::double precision similarity
  from public.bookmark_chunks c join public.bookmarks b on b.id=c.bookmark_id cross join terms t
  where c.user_id=(select auth.uid()) and b.user_id=(select auth.uid()) and b.deleted_at is null and c.source_hash=b.source_hash
 ), lexical as (
  select chunk_id,row_number() over(order by hits desc,chunk_id) r from eligible where hits>0 order by hits desc,chunk_id limit 120
 ), semantic as (
  select chunk_id,row_number() over(order by similarity desc,chunk_id) r from eligible where similarity>=.5 order by similarity desc,chunk_id limit 120
 ), fused as (
  select e.*,l.r lr,s.r sr,(coalesce(1.0/(60+l.r),0)+coalesce(1.0/(60+s.r),0))::double precision fused_score
  from eligible e left join lexical l using(chunk_id) left join semantic s using(chunk_id) where l.r is not null or s.r is not null
 ), diversified as (
  select *,row_number() over(partition by bookmark_id order by fused_score desc,hits desc,chunk_id) source_rank from fused
 ) select chunk_id,bookmark_id,title,url,content,fused_score,source_hash,lr,sr from diversified where source_rank<=3 order by fused_score desc,hits desc,chunk_id limit 60;
$$;
revoke all on function public.hybrid_knowledge_candidates(text,extensions.vector) from public,anon;
grant execute on function public.hybrid_knowledge_candidates(text,extensions.vector) to authenticated;

create or replace function public.retrieve_knowledge(query_text text,query_embedding extensions.vector default null)
returns table(chunk_id uuid,bookmark_id uuid,title text,url text,content text,score double precision,source_hash text)
language sql stable security invoker set search_path=public,extensions as $$
 with candidates as (select *,row_number() over(partition by bookmark_id order by score desc,chunk_id) source_rank from public.hybrid_knowledge_candidates(query_text,query_embedding))
 select chunk_id,bookmark_id,title,url,content,score,source_hash from candidates where source_rank<=2 order by score desc,chunk_id limit 8;
$$;

create or replace function public.search_bookmarks(query_text text,query_embedding extensions.vector default null)
returns table(id uuid) language sql stable security invoker set search_path=public,extensions as $$
 with terms as (select array_agg(distinct t) words from regexp_split_to_table(lower(left(query_text,240)),'[[:space:][:punct:]]+') t where length(t)>1),
 eligible as (
  select b.id,b.created_at,(1-(b.embedding <=> query_embedding))::double precision similarity,
   (select coalesce(sum(case when strpos(lower(b.title),word)>0 then 4.0 else 0 end + case when strpos(lower(array_to_string(b.tags,' ')),word)>0 then 3.0 else 0 end + case when strpos(lower(coalesce(b.ai_summary,b.summary,'')),word)>0 then 1.0 else 0 end + case when strpos(lower(coalesce(b.content,'')),word)>0 then .25 else 0 end + case when strpos(lower(coalesce(b.notes,'')),word)>0 then 1.5 else 0 end + case when strpos(lower(b.canonical_url),word)>0 then .5 else 0 end),0) from unnest(t.words) word)::double precision hits
  from public.bookmarks b cross join terms t where b.user_id=(select auth.uid()) and b.deleted_at is null
 ), lexical as (select id,row_number() over(order by hits desc,created_at desc,id) r from eligible where hits>0 order by hits desc,created_at desc,id limit 120),
 semantic as (select id,row_number() over(order by similarity desc,id) r from eligible where similarity>=.5 order by similarity desc,id limit 120)
 select e.id from eligible e left join lexical l using(id) left join semantic s using(id) where l.r is not null or s.r is not null
 order by (coalesce(1.0/(60+l.r),0)+coalesce(1.0/(60+s.r),0)) desc,e.hits desc,e.created_at desc,e.id limit 60;
$$;

create table public.bookmark_relation_analyses(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 source_id uuid not null references public.bookmarks(id) on delete cascade,target_id uuid not null references public.bookmarks(id) on delete cascade,
 source_hash text not null,target_hash text not null,kind text not null check(kind in ('related','complement','contradict','none')),
 reason text not null check(length(reason)<=1200),evidence jsonb not null,provider text not null,model text not null,prompt_version text not null default 'relation-v1',created_at timestamptz not null default now(),
 check(source_id<target_id),unique(user_id,source_id,target_id,source_hash,target_hash,provider,model,prompt_version)
);
alter table public.bookmark_relation_analyses enable row level security;
create policy own_current_relation_analysis on public.bookmark_relation_analyses for select to authenticated using (
 user_id=(select auth.uid()) and exists(select 1 from public.bookmarks b where b.id=source_id and b.source_hash=bookmark_relation_analyses.source_hash and b.user_id=(select auth.uid()) and b.deleted_at is null)
 and exists(select 1 from public.bookmarks b where b.id=target_id and b.source_hash=bookmark_relation_analyses.target_hash and b.user_id=(select auth.uid()) and b.deleted_at is null)
);
revoke all on public.bookmark_relation_analyses from public,anon,authenticated;
grant select on public.bookmark_relation_analyses to authenticated;
grant select,insert,update,delete on public.bookmark_relation_analyses to service_role;
create index relation_analysis_owner on public.bookmark_relation_analyses(user_id,source_id,target_id,created_at desc);
