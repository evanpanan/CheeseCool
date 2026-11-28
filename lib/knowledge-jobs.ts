import { serviceDatabase } from './supabase';
import {siteAiConfig} from './site-ai';
import { processBookmark, ProcessingError } from './bookmark-processing';

class LostLease extends Error{}
type Job={id:string;user_id:string;bookmark_id:string;lease_token:string;attempts:number;max_attempts:number};
export async function runKnowledgeJobs(ownerId?:string){
 const db=serviceDatabase();if(!db)throw new Error('Worker database is not configured');
 const {data:garbage}=await db.from('bookmark_asset_gc').select('id,object_path').lte('available_at',new Date().toISOString()).limit(30);
 if(garbage?.length){
  const {data:live,error:readError}=await db.rpc('asset_paths_in_use',{paths:garbage.map(g=>g.object_path)});
  if(!readError){const keep=new Set((live||[]).map((a:{object_path:string})=>a.object_path));if(keep.size)await db.from('bookmark_asset_gc').update({available_at:new Date(Date.now()+3600000).toISOString()}).in('object_path',[...keep]);const paths=garbage.filter(g=>!keep.has(g.object_path)).map(g=>g.object_path);const {error}=paths.length?await db.storage.from('knowledge-originals').remove(paths):{error:null};if(!error)await db.from('bookmark_asset_gc').delete().in('id',garbage.filter(g=>!keep.has(g.object_path)).map(g=>g.id));}
 }
 const services=await siteAiConfig();if(services.embedding){const {error}=await db.rpc('enqueue_embedding_updates',{new_space:services.embedding.space,owner_id:ownerId||null});if(error)throw new Error('Index maintenance could not start');}
 const {data,error}=await db.rpc('claim_bookmark_jobs',{owner_id:ownerId||null,batch_size:3});
 if(error)throw new Error('Job claim failed');
 const outcomes=await Promise.all(((data||[]) as Job[]).map(async job=>{
  const started=Date.now();let currentStage='extract';
  const recordEvent=async(state:string,code?:string)=>{const {error}=await db.from('knowledge_job_events').insert({user_id:job.user_id,bookmark_id:job.bookmark_id,state,stage:currentStage,error_code:code||null,duration_ms:Date.now()-started,attempt:job.attempts});if(error)console.warn('Knowledge operation metrics were not recorded');};
  const patch=async(values:object)=>{if('stage' in values&&typeof values.stage==='string')currentStage=values.stage;const {data,error}=await db.from('bookmark_jobs').update({...values,updated_at:new Date().toISOString()}).eq('id',job.id).eq('lease_token',job.lease_token).select('id').maybeSingle();if(error)throw new Error('Job checkpoint failed');if(!data)throw new LostLease();};
  try{
   const result=await processBookmark(db,job.bookmark_id,async stage=>patch({stage}));
   await patch(result.waiting?{state:'waiting',attempts:Math.max(0,job.attempts-1),error_code:result.reason,error_message:result.reason==='index_pending'?'正在分批建立正文索引':result.reason==='organize_pending'?'正在逐段整理完整材料':result.reason==='media_pending'?'正在准备音轨和逐段转写':result.reason==='ocr_pending'?'正在逐页识别扫描文档':result.reason==='asr_unconfigured'?'音视频原件已保存，等待配置语音转写服务':result.reason==='ocr_unconfigured'?'扫描文档原件已保存，等待 OCR 服务':'等待配置模型服务',available_at:new Date(Date.now()+(['index_pending','organize_pending','media_pending','ocr_pending'].includes(result.reason||'')?1000:600000)).toISOString(),lease_until:null}:
    {state:'complete',stage:'complete',error_code:null,error_message:null,lease_until:null});
   await recordEvent(result.waiting?'waiting':'complete',result.reason);
   return {state:result.waiting?'waiting':'complete'};
  }catch(error){
   if(error instanceof LostLease)return {state:'superseded'};
   const known=error instanceof ProcessingError;
   const code=known?error.code:'processing_failed';
   const limited=code==='source_unavailable',cancelled=code==='not_found';
   const retry=(!known||error.retryable)&&job.attempts<job.max_attempts;
   await patch({state:cancelled?'cancelled':limited?'limited':retry?'queued':'failed',error_code:code,
    error_message:known?(code==='source_fetch_failed'&&!retry?'来源连接多次失败，请稍后重新读取':error.message):'后台处理失败，已保留收藏和已完成的步骤',lease_until:null,
    available_at:new Date(Date.now()+Math.min(3600000,30000*2**(job.attempts-1))).toISOString()});
   if(limited)await db.from('bookmarks').update({status:'limited'}).eq('id',job.bookmark_id).eq('user_id',job.user_id);
   await recordEvent(limited?'limited':retry?'queued':'failed',code);
   console.error('Knowledge job did not complete',{jobId:job.id,code,retry});
   return {state:limited?'limited':retry?'queued':'failed',code};
  }
 }));
 return {claimed:outcomes.length,complete:outcomes.filter(x=>x.state==='complete').length,failed:outcomes.filter(x=>x.state==='failed').length};
}
