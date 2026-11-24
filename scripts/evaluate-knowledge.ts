import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite/vector';
import {expandRetrievalQuery,rerankEvidence,type RetrievalCandidate} from '../lib/knowledge-retrieval';
async function main(){
const fixture=JSON.parse(await readFile('tests/fixtures/retrieval-evaluation.json','utf8')) as {documents:{key:string;title:string;tags:string[];content:string}[];queries:{question:string;relevant:string[]}[]};
const db=new PGlite({extensions:{vector}}),owner='00000000-0000-0000-0000-000000000031',keys=new Map<string,string>();
try{
 await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';grant usage on schema auth to authenticated,service_role;insert into auth.users values('${owner}');`);
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 for(const doc of fixture.documents){const hash=createHash('sha256').update(doc.content).digest('hex');const result=await db.query<{id:string}>("insert into public.bookmarks(user_id,original_url,canonical_url,platform,title,tags,content,source_hash) values($1,$2,$2,'web',$3,$4,$5,$6) returning id",[owner,'https://example.invalid/'+doc.key,doc.title,doc.tags,doc.content,hash]);const id=result.rows[0].id;keys.set(id,doc.key);await db.query('insert into public.bookmark_chunks(user_id,bookmark_id,source_hash,ordinal,content) values($1,$2,$3,0,$4)',[owner,id,hash,doc.content]);}
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';`);
 const results=[];
 for(const query of fixture.queries){
  const start=performance.now();const candidates=await db.query<RetrievalCandidate>('select * from public.hybrid_knowledge_candidates($1,null)',[expandRetrievalQuery(query.question)]);
  const ranked=rerankEvidence(query.question,candidates.rows);const actual=[...new Set(ranked.map(c=>keys.get(c.bookmark_id)!))];const rank=actual.findIndex(id=>query.relevant.includes(id));
  results.push({question:query.question,expected:query.relevant,actual,recall_at_5:query.relevant.length?actual.slice(0,5).filter(id=>query.relevant.includes(id)).length/query.relevant.length:1,ndcg_at_5:query.relevant.length?actual.slice(0,5).reduce((sum,id,i)=>sum+(query.relevant.includes(id)?1/Math.log2(i+2):0),0)/Array.from({length:Math.min(5,query.relevant.length)},(_,i)=>1/Math.log2(i+2)).reduce((a,b)=>a+b,0):1,hit_at_3:query.relevant.length?rank>=0&&rank<3:actual.length===0,reciprocal_rank:query.relevant.length&&rank>=0?1/(rank+1):0,latency_ms:Math.round(performance.now()-start)});
 }
 const positive=results.filter(r=>r.expected.length),passed=results.every(r=>r.hit_at_3);
 console.log(JSON.stringify({scope:'synthetic-local-no-external-model',ranking:'rrf-local-v1',queries:results.length,hit_at_3:positive.filter(r=>r.hit_at_3).length/positive.length,mrr:positive.reduce((n,r)=>n+r.reciprocal_rank,0)/positive.length,recall_at_5:positive.reduce((n,r)=>n+r.recall_at_5,0)/positive.length,ndcg_at_5:positive.reduce((n,r)=>n+r.ndcg_at_5,0)/positive.length,p95_latency_ms:results.map(r=>r.latency_ms).sort((a,b)=>a-b)[Math.ceil(results.length*.95)-1],empty_query_pass:results.filter(r=>!r.expected.length).every(r=>r.hit_at_3),results},null,2));
 if(!passed)process.exitCode=1;
}finally{await db.close();}

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
