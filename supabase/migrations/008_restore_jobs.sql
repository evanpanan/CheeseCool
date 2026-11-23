create function internal.restore_bookmark_job() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.deleted_at is not null and new.deleted_at is null then
  update public.bookmark_jobs set state='queued',attempts=0,available_at=now(),lease_token=null,lease_until=null,error_code=null,error_message=null,updated_at=now()
  where bookmark_id=new.id and user_id=new.user_id;
 end if;
 return new;
end;
$$;
revoke all on function internal.restore_bookmark_job() from public,anon,authenticated;
create trigger bookmark_restore after update of deleted_at on public.bookmarks for each row execute function internal.restore_bookmark_job();
