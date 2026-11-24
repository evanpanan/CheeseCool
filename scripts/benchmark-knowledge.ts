import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite/vector';
import {expandRetrievalQuery,rerankEvidence,type RetrievalCandidate} from '../lib/knowledge-retrieval';
import assert from 'node:assert/strict';

async function main(){
 const count=Number(process.env.KNOWLEDGE_BENCH_DOCUMENTS||2000);if(!Number.isInteger(count)||count<100||count>10000)throw new Error('Use 100–10000 documents');
 const db=new PGlite({extensions:{vector}}),owner='00000000-0000-0000-0000-000000000041',other='00000000-0000-0000-0000-000000000042';
 try{
  await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';grant usage on schema auth to authenticated,service_role;insert into auth.users values('${owner}'),('${other}');`);
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  const setup=performance.now();
  await db.query(`insert into public.bookmarks(user_id,original_url,canonical_url,platform,title,content,source_hash)
   select $1,'https://example.invalid/bench/'||i,'https://example.invalid/bench/'||i,'web','Document '||i,'Original reference needle'||lpad(i::text,8,'0'),'version-'||i from generate_series(1,$2::integer) i`,[owner,count]);
  await db.query(`insert into public.bookmark_chunks(user_id,bookmark_id,source_hash,ordinal,content)
   select b.user_id,b.id,b.source_hash,i,'Original reference needle'||lpad(substring(b.source_hash from 9),8,'0')||' section '||i||' '||repeat('保留原件及可验证来源。',30)
   from public.bookmarks b cross join generate_series(0,4) i where b.user_id=$1`,[owner]);
  await db.query(`insert into public.bookmarks(user_id,original_url,canonical_url,platform,title,content,source_hash)
   values($1,'https://foreign.invalid/private','https://foreign.invalid/private','web','Foreign private needle00000001','Foreign private needle00000001','foreign'),($2,'https://stale.invalid/source','https://stale.invalid/source','web','Stale source','Current content','current')`,[other,owner]);
  await db.query(`insert into public.bookmark_chunks(user_id,bookmark_id,source_hash,ordinal,content)
   select user_id,id,case when source_hash='foreign' then 'foreign' else 'outdated' end,0,'needle00000001 Foreign private original'
   from public.bookmarks where source_hash in ('foreign','current')`);
  await db.exec('analyze public.bookmarks;analyze public.bookmark_chunks;');
  const seedMs=Math.round(performance.now()-setup);await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';`);
  const runs:{query:string;latency_ms:number;candidates:number}[]=[];
  for(const number of [1,Math.floor(count/3),Math.floor(count/2),count-1,count,1]){
   const question='needle'+String(number).padStart(8,'0'),start=performance.now();const result=await db.query<RetrievalCandidate>('select * from public.hybrid_knowledge_candidates_v2($1,null)',[expandRetrievalQuery(question)]);
   const selected=rerankEvidence(question,result.rows);assert(selected.length);assert.equal(selected[0].title,'Document '+number);assert(!result.rows.some(r=>r.url.includes('foreign.invalid')||r.url.includes('stale.invalid')));assert(result.rows.length<=60);
   const perSource=new Map<string,number>();for(const row of result.rows)perSource.set(row.bookmark_id,(perSource.get(row.bookmark_id)||0)+1);assert([...perSource.values()].every(n=>n<=3));runs.push({query:question,latency_ms:Math.round(performance.now()-start),candidates:result.rows.length});
  }
  const unrelated=await db.query('select * from public.hybrid_knowledge_candidates_v2($1,null)',['qzxnonexistenttoken']);assert.equal(unrelated.rows.length,0);
  const sorted=runs.map(r=>r.latency_ms).sort((a,b)=>a-b);
  console.log(JSON.stringify({scope:'synthetic-local-pglite-keyword-only-not-production-load',documents:count,chunks:count*5,seed_ms:seedMs,p50_ms:sorted[Math.floor(sorted.length*.5)],p95_ms:sorted[Math.ceil(sorted.length*.95)-1],isolation:'passed',stale_exclusion:'passed',per_source_diversity:'passed',unrelated_empty:'passed',runs},null,2));
 }finally{await db.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
