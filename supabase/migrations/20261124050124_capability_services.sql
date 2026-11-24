create table public.site_capability_settings(
 id boolean primary key default true check(id),provider text not null default 'aliyun' check(provider in ('aliyun','openai')),
 aliyun_key text,aliyun_host text not null default 'dashscope.aliyuncs.com',embedding_model text,ocr_model text,asr_model text
);
alter table public.site_capability_settings enable row level security;
revoke all on public.site_capability_settings from public,anon,authenticated;
grant select,insert,update on public.site_capability_settings to service_role;
insert into public.site_capability_settings(id,provider) values(true,'aliyun');
alter table public.bookmarks add column embedding_space text not null default 'openai:text-embedding-3-small:1536';
alter table public.bookmark_chunks add column embedding_space text not null default 'openai:text-embedding-3-small:1536';
alter table public.knowledge_asset_steps add column remote_task_id text;

create or replace function public.hybrid_knowledge_candidates_v2(query_text text,query_embedding extensions.vector default null,query_space text default 'openai:text-embedding-3-small:1536')
returns table(chunk_id uuid,bookmark_id uuid,title text,url text,content text,score double precision,source_hash text,lexical_rank bigint,semantic_rank bigint)
language sql stable security invoker set search_path=public,extensions as $$
 with terms as (
  select array_agg(distinct t) words from regexp_split_to_table(lower(left(query_text,240)),'[[:space:][:punct:]]+') t where length(t)>1
 ), eligible as (
  select c.id chunk_id,b.id bookmark_id,b.title,coalesce(b.final_url,b.original_url) url,c.content,b.source_hash,
   (select coalesce(sum(case when strpos(lower(c.content),word)>0 then 1.0 else 0 end + case when strpos(lower(b.title),word)>0 then 2.0 else 0 end + case when strpos(lower(array_to_string(b.tags,' ')),word)>0 then 1.5 else 0 end),0) from unnest(t.words) word)::double precision hits,
   (1-(case when c.embedding_space=query_space and c.embedding is not null then c.embedding when b.embedding_space=query_space then b.embedding end <=> query_embedding))::double precision similarity
  from public.bookmark_chunks c join public.bookmarks b on b.id=c.bookmark_id cross join terms t
  where c.user_id=(select auth.uid()) and b.user_id=(select auth.uid()) and b.deleted_at is null and c.source_hash=b.source_hash
 ), lexical_diverse as (
  select *,row_number() over(partition by bookmark_id order by hits desc,chunk_id) doc_rank from eligible where hits>0
 ), lexical as (
  select chunk_id,row_number() over(order by hits desc,chunk_id) r from lexical_diverse where doc_rank<=3 order by hits desc,chunk_id limit 120
 ), semantic_diverse as (
  select *,row_number() over(partition by bookmark_id order by similarity desc,chunk_id) doc_rank from eligible where similarity>=.5
 ), semantic as (
  select chunk_id,row_number() over(order by similarity desc,chunk_id) r from semantic_diverse where doc_rank<=3 order by similarity desc,chunk_id limit 120
 ), fused as (
  select e.*,l.r lr,s.r sr,(coalesce(1.0/(60+l.r),0)+coalesce(1.0/(60+s.r),0))::double precision fused_score
  from eligible e left join lexical l using(chunk_id) left join semantic s using(chunk_id) where l.r is not null or s.r is not null
 ), diversified as (
  select *,row_number() over(partition by bookmark_id order by fused_score desc,hits desc,chunk_id) source_rank from fused
 ) select chunk_id,bookmark_id,title,url,content,fused_score,source_hash,lr,sr from diversified where source_rank<=3 order by fused_score desc,hits desc,chunk_id limit 60;
$$;

revoke all on function public.hybrid_knowledge_candidates_v2(text,extensions.vector,text) from public,anon;
grant execute on function public.hybrid_knowledge_candidates_v2(text,extensions.vector,text) to authenticated;

create or replace function public.search_bookmarks_v2(query_text text,query_embedding extensions.vector default null,query_space text default 'openai:text-embedding-3-small:1536')
returns table(id uuid) language sql stable security invoker set search_path=public,extensions as $$
 with terms as (select array_agg(distinct t) words from regexp_split_to_table(lower(left(query_text,240)),'[[:space:][:punct:]]+') t where length(t)>1),
 eligible as (
  select b.id,b.created_at,(1-(case when b.embedding_space=query_space then b.embedding end <=> query_embedding))::double precision similarity,
   (select coalesce(sum(case when strpos(lower(b.title),word)>0 then 4.0 else 0 end + case when strpos(lower(array_to_string(b.tags,' ')),word)>0 then 3.0 else 0 end + case when strpos(lower(coalesce(b.ai_summary,b.summary,'')),word)>0 then 1.0 else 0 end + case when strpos(lower(coalesce(b.content,'')),word)>0 then .25 else 0 end + case when strpos(lower(coalesce(b.notes,'')),word)>0 then 1.5 else 0 end + case when strpos(lower(b.canonical_url),word)>0 then .5 else 0 end),0) from unnest(t.words) word)::double precision hits
  from public.bookmarks b cross join terms t where b.user_id=(select auth.uid()) and b.deleted_at is null
 ), lexical as (select id,row_number() over(order by hits desc,created_at desc,id) r from eligible where hits>0 order by hits desc,created_at desc,id limit 120),
 semantic as (select id,row_number() over(order by similarity desc,id) r from eligible where similarity>=.5 order by similarity desc,id limit 120)
 select e.id from eligible e left join lexical l using(id) left join semantic s using(id) where l.r is not null or s.r is not null
 order by (coalesce(1.0/(60+l.r),0)+coalesce(1.0/(60+s.r),0)) desc,e.hits desc,e.created_at desc,e.id limit 60;
$$;


revoke all on function public.search_bookmarks_v2(text,extensions.vector,text) from public,anon;
grant execute on function public.search_bookmarks_v2(text,extensions.vector,text) to authenticated;

create function public.index_owned_bookmark_v2(bookmark_id uuid,expected_hash text,new_embedding extensions.vector,new_space text)
returns void language plpgsql security invoker set search_path=public,extensions as $$
declare owner_id uuid;
begin
 select b.user_id into owner_id from public.bookmarks b where b.id=bookmark_id and b.source_hash=expected_hash and b.deleted_at is null;
 if owner_id is null then return;end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 update public.bookmarks set embedding=new_embedding,embedding_space=new_space,status='indexed' where id=bookmark_id and source_hash=expected_hash;
 delete from public.bookmark_edges where user_id=owner_id and kind='semantic' and (source_id=bookmark_id or target_id=bookmark_id);
 insert into public.bookmark_edges(user_id,source_id,target_id,score,kind)
 select owner_id,least(bookmark_id,id),greatest(bookmark_id,id),similarity,'semantic' from (
 select b.id,1-(b.embedding <=> new_embedding) similarity from public.bookmarks b
 where b.user_id=owner_id and b.id<>bookmark_id and b.deleted_at is null and b.embedding is not null and b.embedding_space=new_space
 order by b.embedding <=> new_embedding limit 6) ranked where similarity>=.48
 on conflict(user_id,source_id,target_id) do update set score=excluded.score,kind='semantic';
end;
$$;
revoke all on function public.index_owned_bookmark_v2(uuid,text,extensions.vector,text) from public,anon,authenticated;
grant execute on function public.index_owned_bookmark_v2(uuid,text,extensions.vector,text) to service_role;

alter table public.knowledge_asset_steps add column direct_original boolean not null default false;

create or replace function public.hybrid_knowledge_candidates(query_text text,query_embedding extensions.vector default null)
returns table(chunk_id uuid,bookmark_id uuid,title text,url text,content text,score double precision,source_hash text,lexical_rank bigint,semantic_rank bigint)
language sql stable security invoker set search_path=public,extensions as $$select * from public.hybrid_knowledge_candidates_v2(query_text,query_embedding,'openai:text-embedding-3-small:1536');$$;
create or replace function public.search_bookmarks(query_text text,query_embedding extensions.vector default null)
returns table(id uuid) language sql stable security invoker set search_path=public,extensions as $$select * from public.search_bookmarks_v2(query_text,query_embedding,'openai:text-embedding-3-small:1536');$$;
create function public.enqueue_embedding_updates(new_space text,owner_id uuid default null) returns integer language plpgsql security invoker set search_path=public as $$
declare changed integer;
begin
 update public.bookmark_jobs j set state='queued',attempts=0,available_at=now(),error_code=null,error_message=null
 from public.bookmarks b where b.id=j.bookmark_id and (owner_id is null or b.user_id=owner_id) and j.state='complete' and b.deleted_at is null and b.content is not null and b.ai_summary is not null
 and (b.embedding is null or b.embedding_space<>new_space or not exists(select 1 from public.bookmark_chunks c where c.bookmark_id=b.id and c.source_hash=b.source_hash) or exists(select 1 from public.bookmark_chunks c where c.bookmark_id=b.id and c.source_hash=b.source_hash and (c.embedding is null or c.embedding_space<>new_space)));
 get diagnostics changed=row_count;return changed;
end;$$;
revoke all on function public.enqueue_embedding_updates(text,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_embedding_updates(text,uuid) to service_role;
