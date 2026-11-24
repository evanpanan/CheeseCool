// Temporary release acceptance endpoint. Removed after the live checks.
import {createHmac,timingSafeEqual,randomUUID,randomBytes,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {runKnowledgeEnrichment} from '@/lib/knowledge-enrichment';
import {serviceDatabase,supabaseConfig} from '@/lib/supabase';
export const maxDuration=300;
export async function POST(request:Request){
 const secret=process.env.CRON_SECRET;if(!secret)return new Response(null,{status:401});
 const expected=createHmac('sha256',secret).update('knowledge-backend-acceptance').digest('hex');
 const received=request.headers.get('x-acceptance-token')||'';
 if(received.length!==expected.length||!timingSafeEqual(Buffer.from(received),Buffer.from(expected)))return new Response(null,{status:401});
 const service=serviceDatabase(),config=supabaseConfig();if(!service||!config)return Response.json({error:'configuration'},{status:503});
 const accounts:string[]=[],checks:string[]=[],cleanup:boolean[]=[];
 const ensure=(value:unknown,label:string)=>{if(!value)throw new Error(label);};
 const origin=new URL(request.url).origin;
 async function account(){
  const result=await service!.auth.admin.generateLink({type:'magiclink',email:'cheesecool-qa-'+randomUUID()+'@example.invalid'});
  if(result.error)throw new Error('Temporary test account unavailable');
  accounts.push(result.data.user.id);
  const client=createClient(config!.url,config!.key,{auth:{persistSession:false,autoRefreshToken:false}});
  const verified=await client.auth.verifyOtp({type:result.data.properties.verification_type==='signup'?'signup':'magiclink',token_hash:result.data.properties.hashed_token});
  if(verified.error||!verified.data.session)throw new Error('Temporary test session unavailable: '+String(verified.error?.status)+' '+String(verified.error?.code));
  const value='base64-'+Buffer.from(JSON.stringify(verified.data.session)).toString('base64url');
  const name='sb-czinujtztqmtcddwyqgh-auth-token';
  const cookie=value.length<=3180?name+'='+value:Array.from({length:Math.ceil(value.length/3180)},(_,i)=>`${name}.${i}=${value.slice(i*3180,(i+1)*3180)}`).join('; ');
  return {id:result.data.user.id,cookie};
 }
 async function api(cookie:string,path:string,body?:object){
  const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
  const data=await response.json();return {status:response.status,data};
 }
 async function ok(cookie:string,path:string,body?:object){const result=await api(cookie,path,body);if(result.status!==200)throw new Error(path+': '+result.status+' '+String(result.data.error||''));return result.data;}
 let failure='';
 try{const a=await account(),b=await account();const contents=['原件保护项目规定所有资料必须保留完整原件。摘要不能替代原件。每次更新必须核对来源地址和内容版本，确认原文证据后再接受知识更新。项目负责人要求在存储时验证完整性，避免模型摘要遗漏重要内容。','摘要替代方案规定完成摘要后可以删除原件。这个方案与保留完整原件的要求不同。摘要替代方案优先节省存储成本，但原文证据删除后难以核对历史结论，也不能重新提取原始文件。'];const ids:string[]=[];
 for(let i=0;i<contents.length;i++){const hash=createHash('sha256').update(contents[i]).digest('hex'),url='https://example.invalid/qa-'+randomUUID();const row=await service.from('bookmarks').insert({user_id:a.id,original_url:url,canonical_url:url,platform:'web',title:i===0?'原件保护项目':'摘要替代方案',content:contents[i],source_hash:hash,ai_summary:contents[i],tags:['知识管理'],status:'indexed'}).select('id').single();if(row.error)throw new Error('fixture_record');const id=row.data.id;ids.push(id);await service.from('bookmark_jobs').update({state:'cancelled'}).eq('bookmark_id',id);const chunk=await service.from('bookmark_chunks').insert({user_id:a.id,bookmark_id:id,source_hash:hash,ordinal:0,content:contents[i]});if(chunk.error)throw new Error('fixture_chunks');const original=await service.from('bookmark_sources').insert({user_id:a.id,bookmark_id:id,source_hash:hash,source_url:url,raw_content:contents[i],extracted_content:contents[i]});if(original.error)throw new Error('fixture_source');}
 const first=await ok(a.cookie,'/api/knowledge',{question:'原件保护项目如何保存材料'});ensure(first.citations?.length>0&&first.conversation_id&&first.version===1,'real_cited_answer');
 const second=await ok(a.cookie,'/api/knowledge',{question:'它和摘要替代方案有什么区别',conversation_id:first.conversation_id,expected_version:1});ensure(second.citations?.length>0&&second.version===2,'real_contextual_followup');
 ensure((await api(b.cookie,'/api/knowledge?id='+first.conversation_id)).status===404,'conversation_isolation');ensure((await api(a.cookie,'/api/knowledge',{question:'旧请求',conversation_id:first.conversation_id,expected_version:0})).status===409,'conversation_optimistic_lock');checks.push('real_deepseek_multiturn_cited_answers_and_isolation');
 for(let i=0;i<14;i++){await runKnowledgeEnrichment(a.id);const jobs=await service.from('knowledge_enrichment_jobs').select('state').eq('user_id',a.id);if(jobs.data?.every(j=>j.state==='complete'))break;if(jobs.data?.some(j=>j.state==='failed'))throw new Error('auto_analysis_failed');}
 const jobs=await service.from('knowledge_enrichment_jobs').select('state').eq('user_id',a.id);ensure(jobs.data?.length===2&&jobs.data.every(j=>j.state==='complete'),'auto_analysis_complete');const proposals=await ok(a.cookie,'/api/discoveries');ensure(proposals.proposals.length>0,'automatic_entity_proposals');ensure((await ok(b.cookie,'/api/discoveries')).proposals.length===0,'discovery_isolation');
 const relations=await service.from('bookmark_relation_analyses').select('evidence,review_state').eq('user_id',a.id);ensure(relations.data?.length&&relations.data.every(r=>r.review_state==='pending'&&ids.every(id=>r.evidence.some((e:{source_id:string})=>e.source_id===id))),'automatic_versioned_relation_evidence');checks.push('real_incremental_entities_and_related_source_analysis');
 const entity=proposals.proposals.find((p:{kind:string})=>p.kind==='entity');ensure(entity,'review_fixture');ensure((await api(b.cookie,'/api/discoveries',{id:entity.id,accept:true})).status===409,'foreign_review_rejected');await ok(a.cookie,'/api/discoveries',{id:entity.id,accept:true});const confirmed=await service.from('knowledge_entities').select('id').eq('user_id',a.id);ensure(confirmed.data?.length===1,'explicit_review_creates_entity');checks.push('explicit_owned_discovery_review');
 const operations=await ok(a.cookie,'/api/operations');ensure(operations.diagnostics?.queries.total>=2,'query_telemetry');checks.push('persistent_query_and_automation_diagnostics');
 }catch(error){failure=error instanceof Error?error.message:'unknown';}
 finally{for(const id of accounts){const removed=await service.auth.admin.deleteUser(id);cleanup.push(!removed.error);}}
 return Response.json({checks,cleanup,...(failure?{error:failure}:{})},{status:failure?500:200});
}
