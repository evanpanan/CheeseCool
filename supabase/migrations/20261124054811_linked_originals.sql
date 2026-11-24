create function public.attach_linked_original(owner_id uuid,record_id uuid,file_name text,file_type text,file_kind text,file_parts jsonb,manifest_hash text,source_url text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare total bigint;part jsonb;ordinal integer:=0;
begin
 if file_kind not in('document','audio','video') or manifest_hash!~'^[a-f0-9]{64}$' or jsonb_typeof(file_parts)<>'array' then raise exception 'Invalid original';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 perform 1 from public.bookmarks where id=record_id and user_id=owner_id and deleted_at is null for update;if not found then raise exception 'Record unavailable';end if;
 if exists(select 1 from public.bookmark_assets where bookmark_id=record_id and user_id=owner_id) then return false;end if;
 select sum((p->>'bytes')::bigint) into total from jsonb_array_elements(file_parts)p;
 if total is null or total<=0 or total>200000000 or (select coalesce(sum(bytes),0) from public.bookmark_assets where user_id=owner_id)+(select coalesce(sum(bytes),0) from public.knowledge_uploads where user_id=owner_id and state='uploading' and expires_at>now())+total>500000000 then raise exception 'Original quota reached';end if;
 for part in select * from jsonb_array_elements(file_parts) loop
 if (part->>'ordinal')::integer<>ordinal or part->>'path' not like owner_id::text||'/linked/%' or (part->>'bytes')::bigint<=0 or (part->>'bytes')::bigint>8388608 or part->>'sha256'!~'^[a-f0-9]{64}$' or not exists(select 1 from storage.objects o where o.bucket_id='knowledge-originals' and o.name=part->>'path' and (o.metadata->>'size')::bigint=(part->>'bytes')::bigint) then raise exception 'Original part invalid';end if;ordinal:=ordinal+1;
 end loop;
 insert into public.bookmark_assets(user_id,bookmark_id,object_path,filename,media_type,sha256,bytes,parts,integrity_kind) values(owner_id,record_id,file_parts->0->>'path',file_name,file_type,manifest_hash,total,file_parts,'chunk_manifest');
 update public.bookmarks set record_type=file_kind,final_url=source_url,attributes=attributes||jsonb_build_object('filename',file_name,'size',total,'capture_level','original-file','diarize',true) where id=record_id and user_id=owner_id;
 delete from public.bookmark_asset_gc where object_path in(select p->>'path' from jsonb_array_elements(file_parts)p);return true;
end;$$;
revoke all on function public.attach_linked_original(uuid,uuid,text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.attach_linked_original(uuid,uuid,text,text,text,jsonb,text,text) to service_role;
