alter table public.bookmark_derivations drop constraint bookmark_derivations_origin_check;
alter table public.bookmark_derivations add constraint bookmark_derivations_origin_check check(origin in ('model','import','legacy'));
-- Preserve existing generated summaries without inventing the model, prompt or quotes used in the past.
insert into public.bookmark_derivations(user_id,bookmark_id,source_hash,provider,model,prompt_version,summary,tags,evidence,origin)
 select b.user_id,b.id,b.source_hash,'unknown','unknown','pre-versioning',b.ai_summary,b.tags,'[]'::jsonb,'legacy'
 from public.bookmarks b where b.ai_summary is not null and b.source_hash is not null
 and not exists(select 1 from public.bookmark_derivations d where d.bookmark_id=b.id and d.source_hash=b.source_hash);
