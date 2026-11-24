// Temporary release acceptance endpoint. Removed after the live checks.
import {createHmac,timingSafeEqual,randomUUID,randomBytes,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {runSourceTasks} from '@/lib/source-lifecycle';
import {buildNetwork} from '@/lib/knowledge-network';
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
 try{const a=await account(),b=await account();
 async function fixture(url:string,title:string,content:string,platform='web',manual=true){const hash=createHash('sha256').update(content).digest('hex');const r=await service!.from('bookmarks').insert({user_id:a.id,original_url:url,canonical_url:url,platform,title,content,source_hash:hash,ai_summary:'old summary',notes:'人工笔记',tags:['本人标签'],tags_edited_at:new Date().toISOString(),...(manual?{title_edited_at:new Date().toISOString()}:{}),status:'indexed'}).select('*').single();if(r.error)throw new Error('fixture_record');await service!.from('bookmark_jobs').update({state:'cancelled'}).eq('bookmark_id',r.data.id);const archived=await service!.from('bookmark_sources').insert({user_id:a.id,bookmark_id:r.data.id,source_hash:hash,source_url:url,raw_content:content,extracted_content:content});if(archived.error)throw new Error('fixture_source');return r.data;}
 async function waitTask(id:string,kind:string){for(let i=0;i<50;i++){await runSourceTasks(a.id);const r=await service!.from('knowledge_source_tasks').select('*').eq('bookmark_id',id).eq('kind',kind).single();if(r.data?.state==='complete')return r.data;if(r.data?.state==='failed')throw new Error('source_task_failed');await new Promise(r=>setTimeout(r,500));}throw new Error('source_task_incomplete');}
 const original=await fixture(origin+'/api/internal/source-probe','人工保留标题','This is the original public source version. Preserve original evidence and source hashes. '.repeat(4));const oldChunk=await service!.from('bookmark_chunks').insert({user_id:a.id,bookmark_id:original.id,source_hash:original.source_hash,ordinal:0,content:original.content}).select('id').single();if(oldChunk.error)throw new Error('fixture_chunk');
 await ok(a.cookie,'/api/bookmarks',{operation:'recapture',id:original.id});await waitTask(original.id,'refresh');const current=await service!.from('bookmarks').select('*').eq('id',original.id).single();ensure(current.data?.source_hash!==original.source_hash&&current.data?.content.includes('new source version'),'actual_public_source_update');ensure(current.data?.title==='人工保留标题'&&current.data?.notes==='人工笔记'&&current.data?.tags.includes('本人标签'),'manual_edits_protected');const snapshots=await service!.from('bookmark_sources').select('source_hash').eq('bookmark_id',original.id);ensure(snapshots.data?.some(s=>s.source_hash===original.source_hash)&&snapshots.data.some(s=>s.source_hash===current.data.source_hash),'old_and_new_versions_retained');const gone=await service!.from('bookmark_chunks').select('id').eq('id',oldChunk.data.id);ensure(!gone.data?.length,'stale_vector_rows_removed');checks.push('real_http_refresh_preserves_history_edits_and_invalidates_old_index');
 await ok(a.cookie,'/api/source-lifecycle',{operation:'check',id:original.id});const notModified=await waitTask(original.id,'refresh');ensure(notModified.result==='not_modified','actual_conditional_304');checks.push('real_conditional_etag_not_modified');
 const shortened=await fixture(origin+'/api/internal/source-probe?mode=short','完整资料','完整资料包含许多必须保留的原文与历史，公开来源只返回短说明时不能覆盖它。'.repeat(20));await ok(a.cookie,'/api/source-lifecycle',{operation:'check',id:shortened.id});const review=await waitTask(shortened.id,'refresh');ensure(review.result==='review_required','short_source_requires_review');const unchanged=await service!.from('bookmarks').select('content').eq('id',shortened.id).single();ensure(unchanged.data?.content===shortened.content,'short_source_did_not_replace_original');const pending=await service!.from('knowledge_refresh_candidates').select('id').eq('bookmark_id',shortened.id).eq('state','pending').single();if(!pending.data)throw new Error('review_candidate');ensure((await api(b.cookie,'/api/source-lifecycle',{operation:'review',id:pending.data.id,accept:true})).status===409,'candidate_isolation');await ok(a.cookie,'/api/source-lifecycle',{operation:'review',id:pending.data.id,accept:false});checks.push('incomplete_source_review_and_foreign_account_rejection');
 const tweetText='英伟达领导层变动引发站队争议，黄仁勋回归后，部分高管对原先的公开表态做出澄清。这份资料只记录公开讨论中的观点，原始推文需要完整保留，节点只显示简洁主题。';const tweet=await fixture('https://x.com/cheesecool-test/status/'+Date.now(),tweetText,tweetText,'x',false);await waitTask(tweet.id,'label');const titled=await service!.from('bookmarks').select('*').eq('id',tweet.id).single();ensure(titled.data?.title===tweetText&&titled.data?.content===tweetText,'tweet_original_retained');const graph=buildNetwork([titled.data],[]);ensure(Array.from(graph.nodes[0].display_title).length<=24&&graph.nodes[0].display_title!==tweetText&&titled.data.attributes.node_title?.provider==='deepseek','real_short_node_title');checks.push('real_deepseek_compact_tweet_title_without_rewriting_original');
 }catch(error){failure=error instanceof Error?error.message:'unknown';}
 finally{for(const id of accounts){const r=await service!.auth.admin.deleteUser(id);cleanup.push(!r.error);}}
 return Response.json({checks,cleanup,...(failure?{error:failure}:{})},{status:failure?500:200});
}
