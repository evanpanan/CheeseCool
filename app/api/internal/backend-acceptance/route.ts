// Temporary release acceptance endpoint. Removed after the live checks.
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {serviceDatabase,supabaseConfig} from '@/lib/supabase';
export const maxDuration=180;
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
  const verified=await client.auth.verifyOtp({type:'magiclink',token_hash:result.data.properties.hashed_token});
  if(verified.error||!verified.data.session)throw new Error('Temporary test session unavailable');
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
 async function wait(cookie:string){for(let i=0;i<25;i++){const {jobs}=await ok(cookie,'/api/jobs');if(jobs.length&&jobs.every((j:{state:string})=>['complete','failed','limited'].includes(j.state))){ensure(jobs.every((j:{state:string})=>j.state==='complete'),'Model processing failed');return;}await new Promise(r=>setTimeout(r,1500));}throw new Error('Model processing did not finish');}
 let failure='';
 try{
  const a=await account(),b=await account();
  const content='本条为芝士库后端验收的虚构资料。界面组件通过清晰的状态反馈帮助用户理解操作结果。测试资料明确建议保存完成后使用短暂提示并自动消失。资料还建议为交互动画提供减少动态效果选项。';
  const ids:string[]=[];
  for(let i=0;i<2;i++){const imported=await ok(a.cookie,'/api/bookmarks',{operation:'import',bookmarks:[{original_url:'https://example.com/cheesecool-qa-'+randomUUID(),title:'虚构界面组件验收资料',content,tags:['界面组件'],notes:'自动化验收笔记'}]});ensure(imported.imported===1,'Import count');ids.push(imported.inserted[0].id);}
  checks.push('authenticated_import_and_enqueue');
  ensure((await ok(b.cookie,'/api/bookmarks')).total===0,'Cross-account read');
  ensure((await api(b.cookie,'/api/bookmarks',{operation:'update',id:ids[0],title:'forbidden'})).status===404,'Cross-account write');checks.push('cross_account_isolation');
  await ok(a.cookie,'/api/bookmarks',{operation:'update',id:ids[0],title:'已编辑验收资料',tags:['UI组件'],notes:'人工笔记必须保留'});
  await ok(a.cookie,'/api/bookmarks',{operation:'delete',id:ids[0]});ensure((await ok(a.cookie,'/api/bookmarks')).total===1,'Soft delete');ensure((await ok(a.cookie,'/api/bookmarks?trash=true')).total===1,'Trash');
  const searched=await ok(a.cookie,'/api/knowledge',{operation:'search',question:'界面组件'});ensure(searched.sources.every((s:{bookmark_id:string})=>s.bookmark_id!==ids[0]),'Deleted retrieval');
  await ok(a.cookie,'/api/bookmarks',{operation:'restore',id:ids[0]});ensure((await ok(a.cookie,'/api/bookmarks')).total===2,'Restore');checks.push('edit_trash_and_restore');
  await wait(a.cookie);const detail=await ok(a.cookie,'/api/bookmarks?id='+ids[0]);ensure(detail.bookmark.title==='已编辑验收资料'&&detail.bookmark.notes==='人工笔记必须保留','Manual edit preservation');ensure(detail.sources.length&&detail.derivations.length,'Provenance');
  checks.push('real_model_and_source_versions');
  const backup=await ok(a.cookie,'/api/bookmarks?format=export');ensure(backup.bookmarks.length===2&&backup.sources.length>=2&&backup.derivations.length>=2,'Export completeness');
  const answered=await ok(a.cookie,'/api/knowledge',{question:'界面组件资料建议如何展示保存完成的反馈'});ensure(answered.citations.length&&answered.citations.every((c:{quote:string})=>content.includes(c.quote)),'Valid live citations');checks.push('cited_model_answer');
  const row=backup.bookmarks[0],sources=backup.sources.filter((s:{bookmark_id:string})=>s.bookmark_id===row.id),versions=backup.derivations.filter((s:{bookmark_id:string})=>s.bookmark_id===row.id);
  const imported=await ok(b.cookie,'/api/bookmarks',{operation:'import',bookmarks:[row],sources});const newId=imported.inserted[0].id;
  for(const source of sources)await ok(b.cookie,'/api/bookmarks',{operation:'import_source',id:newId,source});
  for(const derivation of versions)await ok(b.cookie,'/api/bookmarks',{operation:'import_derivation',id:newId,derivation});
  const restored=await ok(b.cookie,'/api/bookmarks?id='+newId);ensure(restored.bookmark.notes===row.notes&&restored.sources.length&&restored.derivations.some((d:{origin:string})=>d.origin==='import'),'Restored provenance');
  const duplicate=await ok(b.cookie,'/api/bookmarks',{operation:'import',bookmarks:[row]});ensure(duplicate.imported===0&&duplicate.duplicates===1,'Duplicate import');await wait(b.cookie);checks.push('backup_restore_and_deduplication');
  const edges=await service.from('bookmark_edges').select('source_id').eq('user_id',a.id);ensure(edges.data?.length,'Persisted tag edges');checks.push('persisted_relationships');
 }catch(error){failure=error instanceof Error?error.message:'Acceptance failed';}
 finally{for(const id of accounts){const result=await service.auth.admin.deleteUser(id);cleanup.push(!result.error);}}
 return Response.json({checks,cleanup,error:failure||undefined},{status:failure?500:200});
}
