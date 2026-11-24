import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite/vector';
import {expandRetrievalQuery,rerankEvidence} from '../lib/knowledge-retrieval';
import {validateRelation,relationExcerpts,sharedTopics} from '../lib/knowledge-relations';

const a={id:'a',title:'界面组件',source_hash:'v1',tags:['UI组件库'],content:'界面组件保存完成后应该提供短暂的反馈提示。原始资料应单独保存，不能用模型摘要替代。'};
const b={id:'b',title:'交互反馈',source_hash:'v2',tags:['界面组件'],content:'交互反馈应在完成后短暂显示，然后自动消失。原件保护是知识库可追溯性的基础。'};

test('relations require literal evidence from both sources and retain both sides when limiting quotes',()=>{
 assert.deepEqual(sharedTopics(a,b),['界面组件']);
 assert.ok(relationExcerpts(a,b).every(quote=>a.content.includes(quote)));
 const left={source_id:'a',quote:'原始资料应单独保存，不能用模型摘要替代。'},right={source_id:'b',quote:'交互反馈应在完成后短暂显示，然后自动消失。'};
 assert.throws(()=>validateRelation({kind:'related',reason:'相似',evidence:[left,{source_id:'b',quote:'这是不存在的原文证据'}]},[a,b]),/双方/);
 const value=validateRelation({kind:'complement',reason:'片段可能互补',evidence:[...Array(8).fill(left),right]},[a,b]);
 assert.ok(value.evidence.some(e=>e.source_id==='b'));assert.ok(value.evidence.every(e=>e.source_hash));
});

test('reranking normalizes aliases, balances sources and preserves evidence identities',()=>{
 assert.ok(expandRetrievalQuery('UI组件').includes('界面组件'));
 const candidates=Array.from({length:8},(_,i)=>({chunk_id:'c'+i,bookmark_id:i<6?'long':'other'+i,title:'界面组件',url:'https://example.org/'+i,source_hash:'original',content:'界面组件保存完成反馈 '+i,score:.02}));
 const ranked=rerankEvidence('界面组件反馈',candidates);
 assert.ok(ranked.filter(c=>c.bookmark_id==='long').length<=2);assert.ok(ranked.some(c=>c.bookmark_id==='other6'));assert.ok(ranked.every(c=>c.source_hash==='original'));
 const repeated=rerankEvidence('界面组件',[candidates[0],{...candidates[0],chunk_id:'duplicate',bookmark_id:'different'}]);assert.equal(repeated.length,1);
});

test('hybrid SQL fuses independent ranks, excludes foreign/deleted/stale sources and invalidates relation caches',async()=>{
 const db=new PGlite({extensions:{vector}}),owner='00000000-0000-0000-0000-000000000021',other='00000000-0000-0000-0000-000000000022';
 try{
  await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';grant usage on schema auth to authenticated,service_role;insert into auth.users values('${owner}'),('${other}');`);
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  const v=(x:number,y:number)=>JSON.stringify([x,y,...Array(1534).fill(0)]);
  const rows=[{title:'界面组件',content:'组件反馈的完整原文。',embedding:v(1,0),who:owner},{title:'无关键词',content:'语义上匹配的虚构资料。',embedding:v(.95,.05),who:owner},{title:'界面组件其他',content:'另一份组件资料。',embedding:v(0,1),who:owner},{title:'界面组件跨账号',content:'绝不能泄露此材料。',embedding:v(1,0),who:other}];
  const ids:string[]=[];
  for(const [i,row] of rows.entries()){
   const result=await db.query<{id:string}>("insert into public.bookmarks(user_id,original_url,canonical_url,platform,title,content,source_hash,embedding) values($1,$2,$2,'web',$3,$4,'version1',$5::extensions.vector) returning id",[row.who,'https://example.org/eval/'+i,row.title,row.content,row.embedding]);const id=result.rows[0].id;ids.push(id);
   for(let ordinal=0;ordinal<(i===0?150:1);ordinal++)await db.query('insert into public.bookmark_chunks(user_id,bookmark_id,source_hash,ordinal,content,embedding) values($1,$2,\'version1\',$3,$4,$5::extensions.vector)',[row.who,id,ordinal,row.content+ordinal,row.embedding]);
  }
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';`);
  const retrieved=await db.query<{bookmark_id:string;lexical_rank:number|null;semantic_rank:number|null}>('select * from public.hybrid_knowledge_candidates($1,$2::extensions.vector)',['组件 反馈',v(1,0)]);
  assert.ok(retrieved.rows.some(r=>r.bookmark_id===ids[2]&&r.lexical_rank!==null),'long source cannot starve other lexical candidates');
  assert.ok(retrieved.rows.some(r=>r.bookmark_id===ids[1]&&r.lexical_rank===null&&r.semantic_rank!==null),'semantic-only recall');assert.ok(retrieved.rows.every(r=>r.bookmark_id!==ids[3]),'no foreign candidates');assert.ok(retrieved.rows.filter(r=>r.bookmark_id===ids[0]).length<=3,'candidate diversity before truncation');
  const idsRanked=await db.query<{id:string}>('select * from public.search_bookmarks($1,$2::extensions.vector)',['组件 反馈',v(1,0)]);assert.equal(idsRanked.rows[0].id,ids[0],'a match in both channels beats either alone');
  await assert.rejects(db.query("insert into public.bookmark_relation_analyses(user_id,source_id,target_id,source_hash,target_hash,kind,reason,evidence,provider,model) values($1,$2,$3,'version1','version1','related','forged','[]','test','test')",[owner,...ids.slice(0,2).sort()]),/permission denied/);
  await db.exec('reset role;');const pair=ids.slice(0,2).sort();await db.query("insert into public.bookmark_relation_analyses(user_id,source_id,target_id,source_hash,target_hash,kind,reason,evidence,provider,model) values($1,$2,$3,'version1','version1','related','test','[]','test','test')",[owner,...pair]);
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';`);assert.equal((await db.query('select * from public.bookmark_relation_analyses')).rows.length,1);
  await db.exec(`set request.jwt.claim.sub='${other}';`);assert.equal((await db.query('select * from public.bookmark_relation_analyses')).rows.length,0);await db.exec(`set request.jwt.claim.sub='${owner}';`);
  await db.query("update public.bookmarks set source_hash='version2' where id=$1",[pair[0]]);assert.equal((await db.query('select * from public.bookmark_relation_analyses')).rows.length,0,'old analysis disappears after source changes');
  await db.query('update public.bookmarks set deleted_at=now() where id=$1',[ids[2]]);
  const remaining=await db.query<{bookmark_id:string}>('select * from public.hybrid_knowledge_candidates($1,null)',['组件']);assert.ok(remaining.rows.every(r=>r.bookmark_id!==pair[0]&&r.bookmark_id!==ids[2]&&r.bookmark_id!==ids[3]));
 }finally{await db.close();}
});
