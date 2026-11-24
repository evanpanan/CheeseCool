-- Diversify within each channel before the bounded global candidate list.
create or replace function public.hybrid_knowledge_candidates(query_text text,query_embedding extensions.vector default null)
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
revoke all on function public.hybrid_knowledge_candidates(text,extensions.vector) from public,anon;
grant execute on function public.hybrid_knowledge_candidates(text,extensions.vector) to authenticated;
