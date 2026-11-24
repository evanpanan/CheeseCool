import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite/vector';
import {resolveCapabilities,validAliyunHost} from '../lib/capability-services';
import {encryptKey,resolveAi} from '../lib/ai-settings';
import {embed} from '../lib/ai';
import {aliyunOcr,submitAliyunTranscript,pollAliyunTranscript,validateAliyunTranscript} from '../lib/domestic-ai';

test('domestic service configuration keeps credentials scoped and rejects arbitrary key endpoints',()=>{
 const previous=process.env.AI_SETTINGS_ENCRYPTION_KEY;process.env.AI_SETTINGS_ENCRYPTION_KEY='09'.repeat(32);
 try{const encrypted=encryptKey('private-test',Buffer.from(process.env.AI_SETTINGS_ENCRYPTION_KEY,'hex'),'aliyun-services');const config=resolveCapabilities({provider:'aliyun',aliyun_key:encrypted},resolveAi(null));assert.equal(config.embedding?.key,'private-test');assert.equal(config.embedding?.dimensions,1536);assert.equal(config.embedding?.endpoint,'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings');assert.match(config.embedding!.space,/aliyun/);assert(!validAliyunHost('example.org'));assert(!validAliyunHost('dashscope.aliyuncs.com.example.org'));assert(validAliyunHost('workspace-123.cn-beijing.maas.aliyuncs.com'));}
 finally{if(previous===undefined)delete process.env.AI_SETTINGS_ENCRYPTION_KEY;else process.env.AI_SETTINGS_ENCRYPTION_KEY=previous;}
});
test('domestic adapters submit real PNG raster input and retain ASR timing and speaker labels',async()=>{
 const original=globalThis.fetch,config={provider:'aliyun' as const,key:'test',host:'dashscope.aliyuncs.com',model:'qwen3.5-ocr'};
 try{
  const {PDFDocument}=await import('pdf-lib');const doc=await PDFDocument.create();doc.addPage();const pdf=Buffer.from(await doc.save());
  globalThis.fetch=async (url,init)=>{assert.equal(String(url),'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');const body=JSON.parse(String(init?.body));assert(body.messages[0].content[0].image_url.url.startsWith('data:image/png;base64,'));return Response.json({choices:[{finish_reason:'stop',message:{content:'Original source evidence 456'}}]});};assert.equal(await aliyunOcr(pdf,config),'Original source evidence 456');
  globalThis.fetch=async(url,init)=>{assert.equal(new Headers(init?.headers).get('X-DashScope-Async'),'enable');const body=JSON.parse(String(init?.body));assert.equal(body.parameters.diarization_enabled,true);return Response.json({output:{task_id:'task-test'}});};assert.equal(await submitAliyunTranscript('https://example.org/private-source',true,{...config,model:'paraformer-v2'}),'task-test');
  globalThis.fetch=async()=>Response.json({output:{task_status:'RUNNING'}});assert.deepEqual(await pollAliyunTranscript('task-test',config),{pending:true});
  const segments=validateAliyunTranscript({transcripts:[{sentences:[{begin_time:1000,end_time:2500,speaker_id:0,text:'原始语音内容。'}]}]},300,5,1,true);assert.equal(segments[0].start,301);assert.equal(segments[0].speaker,'片段2·0');
  globalThis.fetch=async()=>Response.json({data:[{embedding:[1,...Array(1535).fill(0)]}]});const embedding=resolveCapabilities({provider:'aliyun'},resolveAi(null)).embedding;assert.equal((await embed('中文向量',{provider:'aliyun',host:'dashscope.aliyuncs.com',key:'test',model:'text-embedding-v4',endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings',space:'aliyun:text-embedding-v4:1536',dimensions:1536})).length,1536);
 }finally{globalThis.fetch=original;}
});
test('vectors from different providers never share a cosine comparison space',async()=>{
 const db=new PGlite({extensions:{vector}}),owner='00000000-0000-0000-0000-000000000051';
 try{await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';grant usage on schema auth to authenticated,service_role;insert into auth.users values('${owner}');`);for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 const embedding=JSON.stringify([1,...Array(1535).fill(0)]);const result=await db.query<{id:string}>("insert into public.bookmarks(user_id,original_url,canonical_url,platform,title,content,source_hash,embedding,embedding_space) values($1,'https://example.org/space','https://example.org/space','web','Protected source','source text','hash',$2::extensions.vector,'aliyun:text-embedding-v4:1536') returning id",[owner,embedding]);await db.query("insert into public.bookmark_chunks(user_id,bookmark_id,ordinal,source_hash,content,embedding,embedding_space) values($1,$2,0,'hash','source text',$3::extensions.vector,'aliyun:text-embedding-v4:1536')",[owner,result.rows[0].id,embedding]);
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';`);
 assert.equal((await db.query('select * from public.hybrid_knowledge_candidates_v2($1,$2::extensions.vector,$3)',['zznomatch',embedding,'openai:text-embedding-3-small:1536'])).rows.length,0);
 assert.equal((await db.query('select * from public.hybrid_knowledge_candidates_v2($1,$2::extensions.vector,$3)',['zznomatch',embedding,'aliyun:text-embedding-v4:1536'])).rows.length,1);
 }finally{await db.close();}
});
