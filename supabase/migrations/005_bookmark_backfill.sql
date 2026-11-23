alter table public.bookmarks add column processing_attempted_at timestamptz;

create function public.claim_bookmark_backfill(batch_size integer default 3, want_embeddings boolean default false)
returns table(id uuid) language sql security invoker set search_path = public as $$
  with candidates as (
    select b.id from public.bookmarks b
    where b.user_id = (select auth.uid())
      and b.status = 'extracted' and b.content is not null and b.source_hash is not null
      and b.created_at < now() - interval '1 minute'
      and (b.ai_summary is null or (want_embeddings and b.embedding is null))
      and (b.processing_attempted_at is null or b.processing_attempted_at < now() - interval '5 minutes')
    order by b.created_at, b.id
    limit greatest(1, least(batch_size, 3))
    for update skip locked
  )
  update public.bookmarks b set processing_attempted_at = now()
  from candidates c where b.id = c.id returning b.id;
$$;
revoke all on function public.claim_bookmark_backfill(integer,boolean) from public, anon;
grant execute on function public.claim_bookmark_backfill(integer,boolean) to authenticated;
