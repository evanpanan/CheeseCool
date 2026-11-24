create table public.knowledge_source_tasks(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,bookmark_id uuid not null references public.bookmarks(id) on delete cascade,
 kind text not null check(kind in('label','refresh')),expected_hash text,expected_title text not null,state text not null default 'queued' check(state in('queued','running','complete','failed','cancelled')),
 lease_token uuid,lease_until timestamptz,attempts integer not null default 0,available_at timestamptz not null default now(),error_message text,result text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(bookmark_id,kind)
);
create table public.knowledge_source_watches(
 bookmark_id uuid primary key references public.bookmarks(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 interval_hours integer not null default 0 check(interval_hours in(0,24,168)),next_check_at timestamptz not null default now(),last_checked_at timestamptz,
 etag text,last_modified text,final_url text,last_result text,updated_at timestamptz not null default now()
);
create table public.knowledge_refresh_candidates(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,bookmark_id uuid not null references public.bookmarks(id) on delete cascade,
 base_hash text not null,source_hash text not null,title text not null,reason text not null,completeness text not null,
 state text not null default 'pending' check(state in('pending','accepted','rejected')),created_at timestamptz not null default now(),reviewed_at timestamptz,
 foreign key(bookmark_id,source_hash) references public.bookmark_sources(bookmark_id,source_hash) on delete cascade,unique(bookmark_id,base_hash,source_hash)
);
alter table public.knowledge_source_tasks enable row level security;
alter table public.knowledge_source_watches enable row level security;
alter table public.knowledge_refresh_candidates enable row level security;
create policy own_source_tasks on public.knowledge_source_tasks for select to authenticated using(user_id=(select auth.uid()));
create policy own_source_watches on public.knowledge_source_watches for select to authenticated using(user_id=(select auth.uid()));
create policy own_refresh_candidates on public.knowledge_refresh_candidates for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.knowledge_source_tasks,public.knowledge_source_watches,public.knowledge_refresh_candidates from public,anon,authenticated;
grant select on public.knowledge_source_tasks,public.knowledge_source_watches,public.knowledge_refresh_candidates to authenticated;
grant all on public.knowledge_source_tasks,public.knowledge_source_watches,public.knowledge_refresh_candidates to service_role;
create index source_tasks_due on public.knowledge_source_tasks(state,available_at,lease_until);
create index source_tasks_owner on public.knowledge_source_tasks(user_id,updated_at desc);
create index source_watches_due on public.knowledge_source_watches(next_check_at) where interval_hours>0;
create index source_watches_owner on public.knowledge_source_watches(user_id);
create index refresh_candidates_owner on public.knowledge_refresh_candidates(user_id,state,created_at desc);
create function internal.enqueue_node_title() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if current_setting('cheesecool.restoring',true)='on' then return new;end if;
 if new.record_type='web' and new.deleted_at is null and new.source_hash is not null and length(new.content)>=8 and new.title_edited_at is null and ((new.platform='x' and length(new.title)>26) or (length(new.title)>60 and new.title!~'[|｜—–·]')) and (new.attributes->'node_title'->>'source_hash' is distinct from new.source_hash or new.attributes->'node_title'->>'original_title' is distinct from new.title) then
 insert into public.knowledge_source_tasks(user_id,bookmark_id,kind,expected_hash,expected_title) values(new.user_id,new.id,'label',new.source_hash,new.title)
 on conflict(bookmark_id,kind) do update set expected_hash=excluded.expected_hash,expected_title=excluded.expected_title,state='queued',lease_token=null,lease_until=null,attempts=0,available_at=now(),updated_at=now() where knowledge_source_tasks.expected_hash is distinct from excluded.expected_hash or knowledge_source_tasks.expected_title is distinct from excluded.expected_title;
 end if;return new;
end;$$;
revoke all on function internal.enqueue_node_title() from public,anon,authenticated;
create trigger queue_node_title after insert or update of source_hash,title on public.bookmarks for each row execute function internal.enqueue_node_title();
insert into public.knowledge_source_tasks(user_id,bookmark_id,kind,expected_hash,expected_title) select user_id,id,'label',source_hash,title from public.bookmarks where record_type='web' and deleted_at is null and source_hash is not null and length(content)>=8 and title_edited_at is null and ((platform='x' and length(title)>26) or (length(title)>60 and title!~'[|｜—–·]')) on conflict do nothing;
create function public.request_source_refresh(record_id uuid,refresh_hours integer default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid:=auth.uid();b public.bookmarks;task uuid;begin
 select * into b from public.bookmarks where id=record_id and user_id=owner and deleted_at is null and record_type='web' and source_hash is not null;if not found then return null;end if;
 if refresh_hours is not null then if refresh_hours not in(0,24,168) then return null;end if;insert into public.knowledge_source_watches(bookmark_id,user_id,interval_hours,next_check_at) values(b.id,owner,refresh_hours,now()+make_interval(hours=>refresh_hours)) on conflict(bookmark_id) do update set interval_hours=excluded.interval_hours,next_check_at=excluded.next_check_at,updated_at=now();return b.id;end if;
 if not public.consume_knowledge_quota('capture') then return null;end if;
 insert into public.knowledge_source_watches(bookmark_id,user_id) values(b.id,owner) on conflict do nothing;
 insert into public.knowledge_source_tasks(user_id,bookmark_id,kind,expected_hash,expected_title) values(owner,b.id,'refresh',b.source_hash,b.title)
 on conflict(bookmark_id,kind) do update set expected_hash=excluded.expected_hash,expected_title=excluded.expected_title,state='queued',attempts=0,lease_token=null,lease_until=null,available_at=now(),error_message=null,updated_at=now() where knowledge_source_tasks.state<>'running' or knowledge_source_tasks.lease_until<now() returning id into task;
 if task is null then select id into task from public.knowledge_source_tasks where bookmark_id=b.id and kind='refresh' and user_id=owner;end if;return task;
end;$$;
revoke all on function public.request_source_refresh(uuid,integer) from public,anon;
grant execute on function public.request_source_refresh(uuid,integer) to authenticated;
create function public.enqueue_due_source_refreshes() returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.knowledge_source_watches;affected integer:=0;begin
 for w in select sw.* from public.knowledge_source_watches sw join public.bookmarks b on b.id=sw.bookmark_id and b.user_id=sw.user_id where sw.interval_hours>0 and sw.next_check_at<=now() and b.record_type='web' and b.source_hash is not null and b.deleted_at is null order by sw.next_check_at for update of sw skip locked limit 30 loop
 insert into public.knowledge_source_tasks(user_id,bookmark_id,kind,expected_hash,expected_title) select user_id,id,'refresh',source_hash,title from public.bookmarks where id=w.bookmark_id and user_id=w.user_id
 on conflict(bookmark_id,kind) do update set expected_hash=excluded.expected_hash,expected_title=excluded.expected_title,state='queued',attempts=0,available_at=now(),lease_token=null,lease_until=null,error_message=null,updated_at=now() where knowledge_source_tasks.state in('complete','failed','cancelled');
 update public.knowledge_source_watches set next_check_at=now()+make_interval(hours=>w.interval_hours) where bookmark_id=w.bookmark_id;affected:=affected+1;
 end loop;return affected;
end;$$;
revoke all on function public.enqueue_due_source_refreshes() from public,anon,authenticated;
grant execute on function public.enqueue_due_source_refreshes() to service_role;
create function public.claim_source_task(owner_id uuid default null) returns setof public.knowledge_source_tasks language plpgsql security definer set search_path=public,internal,pg_temp as $$
declare t public.knowledge_source_tasks;used integer;begin
 update public.knowledge_source_tasks s set state='cancelled',lease_until=null where state in('queued','running') and not exists(select 1 from public.bookmarks b where b.id=s.bookmark_id and b.user_id=s.user_id and b.deleted_at is null and b.source_hash is not distinct from s.expected_hash);
 select * into t from public.knowledge_source_tasks where (owner_id is null or user_id=owner_id) and state in('queued','running') and available_at<=now() and attempts<4 and (lease_until is null or lease_until<now()) order by case when kind='refresh' then 0 else 1 end,available_at,created_at for update skip locked limit 1;if not found then return;end if;
 insert into internal.knowledge_limits(user_id,action,window_start,requests) values(t.user_id,'source_'||t.kind,date_trunc('day',now()),1) on conflict(user_id,action,window_start) do update set requests=knowledge_limits.requests+1 where knowledge_limits.requests<100 returning requests into used;
 if used is null then update public.knowledge_source_tasks set available_at=date_trunc('day',now())+interval '1 day',error_message='今日来源处理额度已用完，次日继续' where id=t.id;return;end if;
 return query update public.knowledge_source_tasks set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',updated_at=now() where id=t.id returning *;
end;$$;
revoke all on function public.claim_source_task(uuid) from public,anon,authenticated;
grant execute on function public.claim_source_task(uuid) to service_role;
create function public.finish_node_title(work_id uuid,token uuid,node_text text,model_provider text,model_name text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.knowledge_source_tasks;begin
 if length(node_text)<2 or length(node_text)>32 or node_text~'[\r\n]' then return false;end if;
 select * into t from public.knowledge_source_tasks where id=work_id and kind='label' and state='running' and lease_token=token for update;if not found then return false;end if;
 update public.bookmarks set attributes=attributes||jsonb_build_object('node_title',jsonb_build_object('text',node_text,'source_hash',t.expected_hash,'original_title',t.expected_title,'provider',model_provider,'model',model_name,'created_at',now())) where id=t.bookmark_id and user_id=t.user_id and deleted_at is null and source_hash=t.expected_hash and title=t.expected_title and title_edited_at is null;
 if not found then update public.knowledge_source_tasks set state='cancelled',lease_until=null where id=t.id;return false;end if;
 update public.knowledge_source_tasks set state='complete',lease_until=null,result='label_ready',error_message=null,updated_at=now() where id=t.id;return true;
end;$$;
revoke all on function public.finish_node_title(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_node_title(uuid,uuid,text,text,text) to service_role;
-- Common transaction: archive first, replace the current text only after the version guard.
create function internal.apply_source_version(owner_id uuid,record_id uuid,base_hash text,new_hash text,new_title text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.bookmarks;s public.bookmark_sources;begin
 perform 1 from public.bookmark_jobs where bookmark_id=record_id for update;
 if exists(select 1 from public.bookmark_jobs where bookmark_id=record_id and state='running' and lease_until>now()) then return false;end if;
 select * into b from public.bookmarks where id=record_id and user_id=owner_id and deleted_at is null and record_type='web' and source_hash is not distinct from base_hash for update;if not found then return false;end if;
 select * into s from public.bookmark_sources where user_id=owner_id and bookmark_id=record_id and source_hash=new_hash;if not found then return false;end if;
 -- Preserve an imported/legacy current version even if it had no archived row yet.
 if b.source_hash is not null and b.content is not null then insert into public.bookmark_sources(user_id,bookmark_id,source_hash,source_url,raw_content,extracted_content,origin,metadata) values(owner_id,b.id,b.source_hash,coalesce(b.final_url,b.original_url),b.content,b.content,'legacy',jsonb_build_object('title',b.title,'retained_before_refresh',true)) on conflict(bookmark_id,source_hash) do nothing;end if;
 delete from public.bookmark_chunks where user_id=owner_id and bookmark_id=b.id;
 delete from public.bookmark_edges where user_id=owner_id and (source_id=b.id or target_id=b.id);
 update public.bookmarks set title=case when title_edited_at is null then new_title else title end,content=s.extracted_content,source_hash=s.source_hash,summary=coalesce(s.metadata->>'summary',''),ai_summary=null,embedding=null,status='extracted',final_url=s.source_url,fetched_at=now(),tags=case when tags_edited_at is null then '{}' else tags end,attributes=(attributes-'node_title')||jsonb_build_object('capture_level',coalesce(s.metadata->>'capture_level','article'),'capture_origin','web','source_refreshed_at',now()) where id=b.id and user_id=owner_id;
 insert into public.bookmark_jobs(user_id,bookmark_id,state) values(owner_id,b.id,'queued') on conflict(bookmark_id) do update set state='queued',stage='extract',attempts=0,lease_until=null,lease_token=null,available_at=now(),error_code=null,error_message=null,updated_at=now();
 return true;
end;$$;
revoke all on function internal.apply_source_version(uuid,uuid,text,text,text) from public,anon,authenticated;
create function public.finish_source_refresh(work_id uuid,token uuid,material jsonb) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.knowledge_source_tasks;b public.bookmarks;hash text;reason text;status text;begin
 select * into t from public.knowledge_source_tasks where id=work_id and kind='refresh' and state='running' and lease_token=token for update;if not found then return 'superseded';end if;
 select * into b from public.bookmarks where id=t.bookmark_id and user_id=t.user_id and deleted_at is null and source_hash is not distinct from t.expected_hash;if not found then update public.knowledge_source_tasks set state='cancelled',lease_until=null where id=t.id;return 'superseded';end if;
 if coalesce((material->>'not_modified')::boolean,false) then status:='not_modified';
 else
 if length(material->>'content')<8 or length(material->>'content')>500000 or octet_length(material->>'raw')>1500000 or material->>'source_url'!~'^https?://' then raise exception 'Invalid source material';end if;
 hash:=encode(sha256(convert_to(material->>'content','UTF8')),'hex');
 if hash=b.source_hash then status:='unchanged';
 else
 insert into public.bookmark_sources(user_id,bookmark_id,source_hash,source_url,raw_content,extracted_content,media_type,origin,truncated,metadata) values(t.user_id,b.id,hash,material->>'source_url',coalesce(material->>'raw',material->>'content'),material->>'content',coalesce(material->>'media_type','text/html'),'web',coalesce((material->>'truncated')::boolean,false),jsonb_build_object('title',material->>'title','summary',material->>'summary','capture_level',material->>'completeness','refresh',true)) on conflict(bookmark_id,source_hash) do nothing;
 reason:=nullif(material->>'review_reason','');
 if b.attributes->>'capture_origin'='browser' then reason:='当前是浏览器采集版本，公开抓取结果需要核对';end if;
 if b.content is not null and length(b.content)>200 and length(material->>'content')<length(b.content)*.65 then reason:='新正文大幅缩短，需要核对是否采集完整';end if;
 if coalesce((material->>'truncated')::boolean,false) or material->>'completeness' not in('article','public_embed','repository') then reason:='本次仅获得部分公开信息，需要核对';end if;
 if reason is not null then insert into public.knowledge_refresh_candidates(user_id,bookmark_id,base_hash,source_hash,title,reason,completeness) values(t.user_id,b.id,b.source_hash,hash,left(material->>'title',240),reason,coalesce(material->>'completeness','unknown')) on conflict(bookmark_id,base_hash,source_hash) do nothing;status:=case when exists(select 1 from public.knowledge_refresh_candidates where bookmark_id=b.id and base_hash=b.source_hash and source_hash=hash and state='rejected') then 'kept_current' else 'review_required' end;
 elsif internal.apply_source_version(t.user_id,b.id,b.source_hash,hash,left(material->>'title',240)) then status:='updated';
 else update public.knowledge_source_tasks set state='queued',attempts=greatest(0,attempts-1),lease_until=null,available_at=now()+interval '1 minute',updated_at=now() where id=t.id;return 'busy';end if;
 end if;end if;
 insert into public.knowledge_source_watches(bookmark_id,user_id,last_checked_at,last_result,etag,last_modified,final_url) values(b.id,t.user_id,now(),status,left(material->>'etag',512),left(material->>'last_modified',128),coalesce(material->>'source_url',b.final_url,b.original_url)) on conflict(bookmark_id) do update set last_checked_at=now(),last_result=excluded.last_result,etag=excluded.etag,last_modified=excluded.last_modified,final_url=excluded.final_url,updated_at=now();
 update public.knowledge_source_tasks set state='complete',result=status,lease_until=null,error_message=null,updated_at=now() where id=t.id;return status;
end;$$;
revoke all on function public.finish_source_refresh(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_source_refresh(uuid,uuid,jsonb) to service_role;
create function public.review_source_refresh(candidate_id uuid,accept_version boolean) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid:=auth.uid();c public.knowledge_refresh_candidates;begin
 select * into c from public.knowledge_refresh_candidates where id=candidate_id and user_id=owner and state='pending' for update;if not found then return false;end if;
 if accept_version and not internal.apply_source_version(owner,c.bookmark_id,c.base_hash,c.source_hash,c.title) then return false;end if;
 update public.knowledge_refresh_candidates set state=case when accept_version then 'accepted' else 'rejected' end,reviewed_at=now() where id=c.id;update public.knowledge_source_watches set last_result=case when accept_version then 'updated' else 'kept_current' end,updated_at=now() where bookmark_id=c.bookmark_id and user_id=owner;return true;
end;$$;
revoke all on function public.review_source_refresh(uuid,boolean) from public,anon;
grant execute on function public.review_source_refresh(uuid,boolean) to authenticated;
