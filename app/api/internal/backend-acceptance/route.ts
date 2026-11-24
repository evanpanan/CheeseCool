// Temporary release acceptance endpoint. Removed after the live checks.
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {runKnowledgeJobs} from '@/lib/knowledge-jobs';
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
 async function wait(cookie:string,owner?:string){for(let i=0;i<25;i++){if(owner)await runKnowledgeJobs(owner);const {jobs}=await ok(cookie,'/api/jobs');if(jobs.length&&jobs.every((j:{state:string})=>['complete','failed','limited'].includes(j.state))){ensure(jobs.every((j:{state:string})=>j.state==='complete'),'Model processing failed');return;}await new Promise(r=>setTimeout(r,1500));}throw new Error('Model processing did not finish');}
 let failure='';
 try{
  const a=await account(),b=await account();
  const originals=['界面组件的交互反馈应在保存完成后短暂显示，然后自动消失。原始资料必须保留以便核对。','界面组件需要让使用者明确知道保存是否成功。提示可以短暂出现，然后恢复简洁的操作界面。'];
  const ids:string[]=[];
  for(const [i,content] of originals.entries()){
   const value=await ok(a.cookie,'/api/bookmarks',{operation:'import',bookmarks:[{original_url:'https://example.com/relation-qa-'+randomUUID(),title:'虚构界面组件资料 '+i,content,tags:['界面组件']}]});ids.push(value.resolved_id);
  }
  await wait(a.cookie,a.id);
  const search=await ok(a.cookie,'/api/knowledge',{operation:'search',question:'界面组件保存反馈'});
  ensure(search.ranking==='rrf-local-v1'&&new Set(search.sources.map((s:{bookmark_id:string})=>s.bookmark_id)).size===2,'Diversified live retrieval');checks.push('rrf_retrieval_and_source_diversity');
  const body={source_id:ids[0],target_id:ids[1]};
  const basis=await ok(a.cookie,'/api/relations',body);ensure(basis.basis.shared_tags.includes('界面组件'),'Shared topic explanation');checks.push('honest_structural_relationship_basis');
  ensure((await api(b.cookie,'/api/relations',body)).status===404,'Foreign relation access');checks.push('relation_account_isolation');
  const result=await ok(a.cookie,'/api/relations',{...body,analyze:true});
  ensure(result.analysis_status==='model_proposed'&&result.analysis?.evidence.length>=2,'Live model relation analysis');
  for(const quote of result.analysis.evidence){const index=ids.indexOf(quote.source_id);ensure(index>=0&&originals[index].includes(quote.quote),'Both quotes must be literal');}
  const repeated=await ok(a.cookie,'/api/relations',{...body,analyze:true});ensure(repeated.cached===true&&repeated.analysis.id===result.analysis.id,'Versioned cache reuse');checks.push('live_relation_evidence_and_cache');
  await service.from('bookmarks').update({source_hash:'qa-new-version'}).eq('id',ids[0]).eq('user_id',a.id);
  const invalidated=await ok(a.cookie,'/api/relations',body);ensure(invalidated.analysis===null,'Stale relationship hidden');checks.push('source_change_invalidates_analysis');
 }catch(error){failure=error instanceof Error?error.message:'Acceptance failed';}
 finally{for(const id of accounts){const result=await service.auth.admin.deleteUser(id);cleanup.push(!result.error);}try{await runKnowledgeJobs();}catch{cleanup.push(false);}}
 console.info('backend_acceptance',JSON.stringify({checks,cleanup,error:failure||undefined}));
 return Response.json({checks,cleanup,error:failure||undefined},{status:failure?500:200});
}
