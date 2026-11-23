-- Supabase default grants include privileges that bypass row policies.
revoke truncate, references, trigger on public.bookmarks, public.bookmark_edges from authenticated;
