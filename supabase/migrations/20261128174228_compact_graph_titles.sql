-- Graph aliases are bounded independently of protected source titles.
create or replace function internal.node_title_width(value text) returns numeric
language sql immutable strict set search_path=pg_catalog as $$
 select length(regexp_replace(value,'[ -~]','','g')) + (length(value)-length(regexp_replace(value,'[ -~]','','g')))*0.5;
$$;
revoke all on function internal.node_title_width(text) from public,anon,authenticated;

create or replace function internal.enqueue_node_title() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if current_setting('cheesecool.restoring',true)='on' then return new;end if;
 if new.record_type='web' and new.deleted_at is null and new.source_hash is not null and length(new.content)>=8 and new.title_edited_at is null
 and (internal.node_title_width(new.title)>14 or length(new.title)>28)
 and (new.attributes->'node_title'->>'source_hash' is distinct from new.source_hash
  or new.attributes->'node_title'->>'original_title' is distinct from new.title
  or coalesce(length(new.attributes->'node_title'->>'text'),0)<3
  or length(new.attributes->'node_title'->>'text')>28
  or internal.node_title_width(new.attributes->'node_title'->>'text')>14) then
 insert into public.knowledge_source_tasks(user_id,bookmark_id,kind,expected_hash,expected_title) values(new.user_id,new.id,'label',new.source_hash,new.title)
 on conflict(bookmark_id,kind) do update set expected_hash=excluded.expected_hash,expected_title=excluded.expected_title,state='queued',lease_token=null,lease_until=null,attempts=0,available_at=now(),updated_at=now()
 where knowledge_source_tasks.expected_hash is distinct from excluded.expected_hash or knowledge_source_tasks.expected_title is distinct from excluded.expected_title or knowledge_source_tasks.state in('complete','failed','cancelled');
 end if;return new;
end;$$;
revoke all on function internal.enqueue_node_title() from public,anon,authenticated;

create or replace function public.finish_node_title(work_id uuid,token uuid,node_text text,model_provider text,model_name text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.knowledge_source_tasks;begin
 if length(node_text)<3 or length(node_text)>28 or internal.node_title_width(node_text)>14 or node_text~'[\r\n]' then return false;end if;
 select * into t from public.knowledge_source_tasks where id=work_id and kind='label' and state='running' and lease_token=token for update;if not found then return false;end if;
 update public.bookmarks set attributes=attributes||jsonb_build_object('node_title',jsonb_build_object('text',node_text,'source_hash',t.expected_hash,'original_title',t.expected_title,'provider',model_provider,'model',model_name,'created_at',now()))
 where id=t.bookmark_id and user_id=t.user_id and deleted_at is null and source_hash=t.expected_hash and title=t.expected_title and title_edited_at is null;
 if not found then update public.knowledge_source_tasks set state='cancelled',lease_until=null where id=t.id;return false;end if;
 update public.knowledge_source_tasks set state='complete',lease_until=null,result='label_ready',error_message=null,updated_at=now() where id=t.id;return true;
end;$$;
revoke all on function public.finish_node_title(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_node_title(uuid,uuid,text,text,text) to service_role;

-- Backfill existing oversized labels without changing original titles or text.
insert into public.knowledge_source_tasks(user_id,bookmark_id,kind,expected_hash,expected_title)
select user_id,id,'label',source_hash,title from public.bookmarks
where record_type='web' and deleted_at is null and source_hash is not null and length(content)>=8 and title_edited_at is null
 and (internal.node_title_width(title)>14 or length(title)>28)
 and (attributes->'node_title'->>'source_hash' is distinct from source_hash
  or attributes->'node_title'->>'original_title' is distinct from title
  or coalesce(length(attributes->'node_title'->>'text'),0)<3
  or length(attributes->'node_title'->>'text')>28
  or internal.node_title_width(attributes->'node_title'->>'text')>14)
on conflict(bookmark_id,kind) do update set expected_hash=excluded.expected_hash,expected_title=excluded.expected_title,state='queued',attempts=0,available_at=now(),lease_token=null,lease_until=null,error_message=null,updated_at=now()
where knowledge_source_tasks.state in('complete','failed','cancelled') or knowledge_source_tasks.expected_hash is distinct from excluded.expected_hash or knowledge_source_tasks.expected_title is distinct from excluded.expected_title;
