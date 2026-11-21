create schema if not exists extensions;
create extension if not exists vector with schema extensions;
set search_path = public, extensions;

create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  original_url text not null,
  final_url text,
  canonical_url text not null,
  platform text not null check (platform in ('web','x','github','xiaohongshu','douyin')),
  title text not null,
  cover_url text,
  summary text not null default '',
  ai_summary text,
  tags text[] not null default '{}',
  content text,
  source_hash text,
  fetched_at timestamptz,
  embedding extensions.vector(1536),
  status text not null default 'saved' check (status in ('saved','limited','extracted','indexed')),
  created_at timestamptz not null default now(),
  unique (user_id, canonical_url),
  unique (user_id, id)
);

create index bookmarks_recent on public.bookmarks(user_id, created_at desc);

create table public.bookmark_edges (
  user_id uuid not null default auth.uid(),
  source_id uuid not null,
  target_id uuid not null,
  score double precision not null check (score between 0 and 1),
  primary key (user_id, source_id, target_id),
  foreign key (user_id, source_id) references public.bookmarks(user_id,id) on delete cascade,
  foreign key (user_id, target_id) references public.bookmarks(user_id,id) on delete cascade,
  check (source_id < target_id)
);

create index bookmark_edges_target on public.bookmark_edges(user_id, target_id);
alter table public.bookmarks enable row level security;
alter table public.bookmark_edges enable row level security;
create policy own_bookmarks on public.bookmarks to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own_edges on public.bookmark_edges to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.bookmarks, public.bookmark_edges from public, anon;
grant usage on schema extensions to authenticated;
grant select, insert, update, delete on public.bookmarks, public.bookmark_edges to authenticated;

create function public.index_bookmark(
  bookmark_id uuid, expected_hash text, new_summary text, new_tags text[], new_embedding extensions.vector
) returns void language plpgsql security invoker set search_path = public, extensions as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  update public.bookmarks set ai_summary = new_summary, tags = new_tags, embedding = new_embedding, status = 'indexed'
    where user_id = auth.uid() and id = bookmark_id and source_hash = expected_hash;
  if not found then return; end if;

  delete from public.bookmark_edges where user_id = auth.uid()
    and (source_id = bookmark_id or target_id = bookmark_id);

  insert into public.bookmark_edges(source_id, target_id, score)
  select least(bookmark_id, id), greatest(bookmark_id, id), similarity
  from (
    select id, 1 - (embedding <=> new_embedding) as similarity
    from public.bookmarks where user_id = auth.uid() and id <> bookmark_id and embedding is not null
    order by embedding <=> new_embedding limit 6
  ) candidates
  where similarity >= 0.48
  on conflict (user_id, source_id, target_id) do update set score = excluded.score;
end;
$$;

create function public.search_bookmarks(query_text text, query_embedding extensions.vector default null)
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
          b.canonical_url, b.content)), term) > 0) as hits
    from public.bookmarks b cross join query q where b.user_id = auth.uid()
  )
  select s.id from scored s where s.hits > 0 or s.similarity >= 0.28
  order by (s.similarity + least(s.hits, 5) * 0.18) desc, s.created_at desc limit 60;
$$;

revoke all on function public.index_bookmark(uuid,text,text,text[],extensions.vector) from public, anon;
revoke all on function public.search_bookmarks(text,extensions.vector) from public, anon;
grant execute on function public.index_bookmark(uuid,text,text,text[],extensions.vector) to authenticated;
grant execute on function public.search_bookmarks(text,extensions.vector) to authenticated;
