create function public.expand_entity_retrieval_query(query_text text) returns text language sql stable security invoker set search_path=public as $$
 with matching as(
 select e.name,e.aliases from public.knowledge_entities e where e.user_id=(select auth.uid()) and e.merged_into is null
 and exists(select 1 from unnest(e.source_ids) sid join public.bookmarks b on b.id=sid where b.user_id=(select auth.uid()) and b.deleted_at is null)
 and not exists(select 1 from jsonb_each_text(e.source_versions)v where not exists(select 1 from public.bookmarks b where b.id::text=v.key and b.source_hash=v.value and b.user_id=(select auth.uid()) and b.deleted_at is null))
 and exists(select 1 from unnest(e.aliases||array[e.name])term where length(term)>=2 and strpos(lower(query_text),lower(term))>0)
 order by length(e.name) desc,e.id limit 5
 ), words as(select distinct left(term,50) term from matching cross join lateral unnest(aliases||array[name])term order by 1 limit 12)
 select left(left(query_text,240)||coalesce(' '||(select string_agg(term,' ') from words),''),640);
$$;
revoke all on function public.expand_entity_retrieval_query(text) from public,anon;
grant execute on function public.expand_entity_retrieval_query(text) to authenticated;
