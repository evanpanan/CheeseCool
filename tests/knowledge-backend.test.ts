import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite/vector';
import {chunkContent,normalizeTags,validEvidence} from '../lib/knowledge-content';
import {answerFromEvidence} from '../lib/ai';

test('normalizes topic aliases, chunks full Unicode text and rejects invented evidence',()=>{
 assert.deepEqual(normalizeTags(['UI','界面设计','React组件','动效']),['界面设计','界面组件','交互动画']);
 const text='这是😀完整原文。'.repeat(500);const chunks=chunkContent(text);assert(chunks.length>1);assert.equal(chunks[0],Array.from(text).slice(0,1800).join(''));assert(chunks.every(c=>!c.includes('\ufffd')));
 assert.deepEqual(validEvidence('This is real source evidence.', ['real source evidence.','invented statement']),['real source evidence.']);
});

test('persistent jobs survive interruptions, isolate owners and retrieve original evidence',async()=>{
 const db=new PGlite({extensions:{vector}});const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
 try{
 await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';grant usage on schema auth to authenticated,service_role;insert into auth.users values('${a}'),('${b}');`);
 for(const file of ['001_second_brain','002_ai_settings','003_site_ai_settings','004_restrict_authenticated_privileges','005_bookmark_backfill','006_knowledge_backend','007_legacy_derivations','008_restore_jobs','009_knowledge_records','010_backup_provenance','20261124041432_hybrid_retrieval','20261124042451_candidate_diversity'])await db.exec(await readFile('supabase/migrations/'+file+'.sql','utf8'));
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${a}';`);
 const row=await db.query<{id:string}>("insert into public.bookmarks(original_url,canonical_url,platform,title) values('https://example.com','https://example.com','web','界面组件') returning id");const id=row.rows[0].id;
 assert.equal((await db.query('select * from public.bookmark_jobs')).rows.length,1,'job committed with bookmark');
 await assert.rejects(db.query('select * from public.claim_bookmark_jobs(null,3)'),/permission denied/);
 await db.exec('reset role;set role service_role;');
 const claimed=await db.query<{id:string;lease_token:string}>('select * from public.claim_bookmark_jobs(null,3)');assert.equal(claimed.rows.length,1);
 assert.equal((await db.query('select * from public.claim_bookmark_jobs(null,3)')).rows.length,0,'unexpired lease cannot be claimed twice');
 await db.exec("update public.bookmark_jobs set lease_until=now()-interval '1 second'");
 const reclaimed=await db.query<{attempts:number;lease_token:string}>('select * from public.claim_bookmark_jobs(null,3)');assert.equal(reclaimed.rows[0].attempts,2);assert.notEqual(reclaimed.rows[0].lease_token,claimed.rows[0].lease_token);
 await db.query("update public.bookmarks set content='组件正文证据与设计资料',source_hash='hash',status='extracted',tags=array['界面组件'] where id=$1",[id]);
 await db.query("insert into public.bookmark_sources(user_id,bookmark_id,source_hash,source_url,raw_content,extracted_content) values($1,$2,'hash','https://example.com','original','组件正文证据与设计资料')",[a,id]);
 await db.query("insert into public.bookmark_chunks(user_id,bookmark_id,source_hash,ordinal,content) values($1,$2,'hash',0,'组件正文证据与设计资料')",[a,id]);
 await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${a}';`);
 assert.equal((await db.query("select * from public.retrieve_knowledge('组件')")).rows.length,1);
 await assert.rejects(db.query("update public.bookmark_sources set raw_content='tampered'"),/permission denied/);
 await db.query('update public.bookmarks set deleted_at=now() where id=$1',[id]);assert.equal((await db.query("select * from public.retrieve_knowledge('组件')")).rows.length,0);assert.equal((await db.query("select * from public.search_bookmarks('组件')")).rows.length,0);
 await db.query('update public.bookmarks set deleted_at=null where id=$1',[id]);assert.equal((await db.query("select * from public.retrieve_knowledge('组件')")).rows.length,1);
 for(let i=0;i<20;i++)assert.equal((await db.query<{ok:boolean}>("select public.consume_knowledge_quota('answer') as ok")).rows[0].ok,true);
 assert.equal((await db.query<{ok:boolean}>("select public.consume_knowledge_quota('answer') as ok")).rows[0].ok,false,'persistent model quota cannot be bypassed by refresh');
 assert.equal((await db.query<{ok:boolean}>("select public.consume_knowledge_quota('unknown') as ok")).rows[0].ok,false);
 await db.exec('reset role;set role service_role;');
 await db.exec("update public.bookmark_jobs set attempts=4,state='running',lease_until=now()-interval '1 second'");
 assert.equal((await db.query('select * from public.claim_bookmark_jobs(null,3)')).rows.length,0);
 assert.equal((await db.query<{state:string}>('select state from public.bookmark_jobs')).rows[0].state,'failed','interrupted final attempt becomes visible failure');
 await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${a}';`);
 assert.equal((await db.query<{ok:boolean}>('select public.retry_own_bookmark($1) as ok',[id])).rows[0].ok,true);

 await db.exec(`set request.jwt.claim.sub='${b}'`);assert.equal((await db.query('select * from public.bookmark_sources')).rows.length,0);assert.equal((await db.query('select * from public.bookmark_jobs')).rows.length,0);assert.equal((await db.query("select * from public.retrieve_knowledge('组件')")).rows.length,0);assert.equal((await db.query<{ok:boolean}>('select public.retry_own_bookmark($1) as ok',[id])).rows[0].ok,false);
 }finally{await db.close();}
});

test('answers expose only validated citations from retrieved sources',async()=>{
 const original=globalThis.fetch;let invented=false;
 globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({answer:'根据原文的回答',citations:[{chunk_id:invented?'foreign':'chunk',quote:'This is exact original evidence.'}]})}}]});
 try{
 const chunks=[{chunk_id:'chunk',bookmark_id:'owned',title:'原文',url:'https://example.com',content:'This is exact original evidence.',score:1}];
 assert.equal((await answerFromEvidence('问题',chunks,{provider:'deepseek',key:'test',model:'test'})).citations.length,1);
 invented=true;assert.equal((await answerFromEvidence('问题',chunks,{provider:'deepseek',key:'test',model:'test'})).citations.length,0);
 }finally{globalThis.fetch=original;}
});


test('typed records preserve complete originals and confirmed analysis publishes only once',async()=>{
 const db=new PGlite({extensions:{vector}});const owner='00000000-0000-0000-0000-000000000011',other='00000000-0000-0000-0000-000000000012';
 try{
 await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';grant usage on schema auth to authenticated,service_role;insert into auth.users values('${owner}'),('${other}');`);
 for(const name of ['001_second_brain','002_ai_settings','003_site_ai_settings','004_restrict_authenticated_privileges','005_bookmark_backfill','006_knowledge_backend','007_legacy_derivations','008_restore_jobs','009_knowledge_records','010_backup_provenance','20261124041432_hybrid_retrieval','20261124042451_candidate_diversity'])await db.exec(await readFile('supabase/migrations/'+name+'.sql','utf8'));
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';`);
 const raw=JSON.stringify({messages:[{role:'user',content:'完整对话原稿中的一句话'},{role:'assistant',content:'完整回答，不能用摘要替代。'}]});
 const row=await db.query<{id:string}>("select public.create_knowledge_record('ai_conversation','完整对话',$1,$2,'{}') as id",['完整对话原稿中的一句话',raw]);const id=row.rows[0].id;
 assert.equal((await db.query<{raw_content:string}>('select raw_content from public.bookmark_sources')).rows[0].raw_content,raw);
 const hash=(await db.query<{source_hash:string}>('select source_hash from public.bookmarks where id=$1',[id])).rows[0].source_hash;
 await db.exec('reset role;set role service_role;');
 const draft=await db.query<{id:string}>("insert into public.knowledge_insights(user_id,title,body,source_ids,provider,model,evidence,entities) values($1,'观点草稿','经过确认的观点',array[$2::uuid],'test','test',$3::jsonb,$4::jsonb) returning id",[owner,id,JSON.stringify([{source_id:id,source_hash:hash,quote:'完整对话原稿中的一句话'}]),JSON.stringify([{name:'原件保护',kind:'concept',description:'保存完整原件',source_id:id,quote:'完整对话原稿中的一句话'}])]);
 await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${other}';`);
 assert.equal((await db.query<{id:string}>('select public.confirm_knowledge_insight($1) as id',[draft.rows[0].id])).rows[0].id,null);
 await db.exec(`set request.jwt.claim.sub='${owner}';`);
 assert.ok((await db.query<{id:string}>('select public.confirm_knowledge_insight($1) as id',[draft.rows[0].id])).rows[0].id);
 assert.equal((await db.query<{id:string}>('select public.confirm_knowledge_insight($1) as id',[draft.rows[0].id])).rows[0].id,null);
 assert.equal((await db.query('select * from public.knowledge_entities')).rows.length,1);
 assert.equal((await db.query('select * from public.bookmarks')).rows.length,2);
 }finally{await db.close();}
});
