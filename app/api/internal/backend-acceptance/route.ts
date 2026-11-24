// Temporary release acceptance endpoint. Removed after the live checks.
import {createHmac,timingSafeEqual,randomUUID,randomBytes,createHash} from 'node:crypto';
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
  const {PDFDocument,StandardFonts}=await import('pdf-lib');const document=await PDFDocument.create(),font=await document.embedFont(StandardFonts.Helvetica);document.addPage().drawText('Original source documents must retain all bytes and preserve evidence.',{font});await document.attach(randomBytes(9000000),'unreferenced-test-padding.bin');const bytes=Buffer.from(await document.save());ensure(bytes.length>8388608,'Large fixture');
  const upload=await ok(a.cookie,'/api/uploads',{operation:'init',filename:'large-original.pdf',bytes:bytes.length,media_type:'application/pdf'});ensure(upload.part_count===2,'Two-part upload');
  ensure((await api(b.cookie,'/api/uploads',{operation:'status',id:upload.id})).status===404,'Upload isolation');
  for(let ordinal=0;ordinal<upload.part_count;ordinal++){
   const part=bytes.subarray(ordinal*upload.part_size,Math.min(bytes.length,(ordinal+1)*upload.part_size));const signed=await ok(a.cookie,'/api/uploads',{operation:'sign',id:upload.id,ordinal});
   const response=await fetch(signed.url,{method:'PUT',headers:{'Content-Type':'application/octet-stream','x-upsert':'false'},body:part});ensure(response.ok,'Direct private storage upload: '+response.status);
   await ok(a.cookie,'/api/uploads',{operation:'part_done',id:upload.id,ordinal,sha256:createHash('sha256').update(part).digest('hex')});
   if(ordinal===0){const resumed=await ok(a.cookie,'/api/uploads',{operation:'status',id:upload.id});ensure(resumed.parts.length===1,'Resumable checkpoint');}
  }
  const finished=await ok(a.cookie,'/api/uploads',{operation:'complete',id:upload.id});const repeated=await ok(a.cookie,'/api/uploads',{operation:'complete',id:upload.id});ensure(repeated.id===finished.id,'Finalize idempotency');checks.push('large_direct_upload_resume_and_finalize');
  await wait(a.cookie,a.id);const detail=await ok(a.cookie,'/api/bookmarks?id='+finished.id);ensure(detail.assets.length===1,'Original file metadata');const assetId=detail.assets[0].id;
  const original=await fetch(origin+'/api/assets?id='+assetId,{headers:{Cookie:a.cookie}});ensure(original.status===200,'Download status');const downloaded=Buffer.from(await original.arrayBuffer());ensure(createHash('sha256').update(downloaded).digest('hex')===createHash('sha256').update(bytes).digest('hex'),'Complete original byte integrity');
  const range=await fetch(origin+'/api/assets?id='+assetId,{headers:{Cookie:a.cookie,Range:'bytes=8388604-8388612'}});ensure(range.status===206&&Buffer.from(await range.arrayBuffer()).equals(bytes.subarray(8388604,8388613)),'Cross-part HTTP range');
  ensure((await fetch(origin+'/api/assets?id='+assetId,{headers:{Cookie:b.cookie}})).status===404,'Private download isolation');checks.push('private_large_original_integrity_and_range');
  const capture=await ok(a.cookie,'/api/capture',{url:'https://example.com/browser-qa-'+randomUUID(),title:'Browser original',content:'This is the complete captured source text from a user-readable browser article. Original sources are retained.',html:'<article>This is the complete captured source text from a user-readable browser article. Original sources are retained.</article>'});
  await wait(a.cookie,a.id);const captured=await ok(a.cookie,'/api/bookmarks?id='+capture.id);ensure(captured.sources.some((s:{origin:string})=>s.origin==='browser'),'Browser capture provenance');checks.push('browser_capture_retains_provenance');
  const health=await ok(a.cookie,'/api/operations');ensure(health.scope==='account'&&health.metrics.last24h.complete>=1,'Owner-scoped processing metrics');checks.push('persistent_processing_metrics');
 }catch(error){failure=error instanceof Error?error.message:'Acceptance failed';}
 finally{for(const id of accounts){const result=await service.auth.admin.deleteUser(id);cleanup.push(!result.error);}try{await runKnowledgeJobs();}catch{cleanup.push(false);}}
 console.info('backend_acceptance',JSON.stringify({checks,cleanup,error:failure||undefined}));
 return Response.json({checks,cleanup,error:failure||undefined},{status:failure?500:200});
}
