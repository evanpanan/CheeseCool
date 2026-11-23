alter table public.knowledge_insights add column origin text not null default 'model' check(origin in ('model','import'));
alter table public.knowledge_entities add column origin text not null default 'confirmed' check(origin in ('confirmed','import'));

create index knowledge_insights_owner on public.knowledge_insights(user_id,created_at desc);
create index knowledge_insights_published on public.knowledge_insights(published_bookmark_id);
create index knowledge_entities_owner on public.knowledge_entities(user_id,confirmed_at desc);

drop function public.retrieve_knowledge(text,extensions.vector);
create function public.retrieve_knowledge(query_text text,query_embedding extensions.vector default null)
returns table(chunk_id uuid,bookmark_id uuid,title text,url text,content text,score double precision,source_hash text)
language sql stable security invoker set search_path=public,extensions as $$
 with terms as(select array_agg(t) words from regexp_split_to_table(lower(left(query_text,240)),'[[:space:][:punct:]]+') t where length(t)>1),
 ranked as(select c.id chunk_id,b.id bookmark_id,b.title,coalesce(b.final_url,b.original_url) url,c.content,
 (coalesce(1-(coalesce(c.embedding,b.embedding) <=> query_embedding),0)+(select count(*)*.2 from unnest(t.words) word where strpos(lower(b.title||' '||c.content||' '||array_to_string(b.tags,' ')),word)>0))::double precision score,b.source_hash
 from public.bookmark_chunks c join public.bookmarks b on b.id=c.bookmark_id cross join terms t
 where c.user_id=(select auth.uid()) and b.deleted_at is null and c.source_hash=b.source_hash)
 select * from ranked where score>=.2 order by score desc,chunk_id limit 8;
$$;
revoke all on function public.retrieve_knowledge(text,extensions.vector) from public,anon;
grant execute on function public.retrieve_knowledge(text,extensions.vector) to authenticated;

