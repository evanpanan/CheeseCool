import { serviceDatabase } from './supabase';
import { processBookmark, ProcessingError } from './bookmark-processing';

class LostLease extends Error{}
type Job={id:string;user_id:string;bookmark_id:string;lease_token:string;attempts:number;max_attempts:number};
export async function runKnowledgeJobs(ownerId?:string){
 const db=serviceDatabase();if(!db)throw new Error('Worker database is not configured');
 const {data,error}=await db.rpc('claim_bookmark_jobs',{owner_id:ownerId||null,batch_size:3});
 if(error)throw new Error('Job claim failed');
 const outcomes=await Promise.all(((data||[]) as Job[]).map(async job=>{
  const patch=async(values:object)=>{const {data,error}=await db.from('bookmark_jobs').update({...values,updated_at:new Date().toISOString()}).eq('id',job.id).eq('lease_token',job.lease_token).select('id').maybeSingle();if(error)throw new Error('Job checkpoint failed');if(!data)throw new LostLease();};
  try{
   const result=await processBookmark(db,job.bookmark_id,async stage=>patch({stage}));
   await patch(result.waiting?{state:'waiting',attempts:Math.max(0,job.attempts-1),error_code:result.reason,error_message:result.reason==='index_pending'?'正在分批建立正文索引':'等待配置模型服务',available_at:new Date(Date.now()+(result.reason==='index_pending'?1000:600000)).toISOString(),lease_until:null}:
    {state:'complete',stage:'complete',error_code:null,error_message:null,lease_until:null});
   return {state:result.waiting?'waiting':'complete'};
  }catch(error){
   if(error instanceof LostLease)return {state:'superseded'};
   const known=error instanceof ProcessingError;
   const code=known?error.code:'processing_failed';
   const limited=code==='source_unavailable',cancelled=code==='not_found';
   const retry=(!known||error.retryable)&&job.attempts<job.max_attempts;
   await patch({state:cancelled?'cancelled':limited?'limited':retry?'queued':'failed',error_code:code,
    error_message:known?error.message:'后台处理失败，已保留收藏和已完成的步骤',lease_until:null,
    available_at:new Date(Date.now()+Math.min(3600000,30000*2**(job.attempts-1))).toISOString()});
   if(limited)await db.from('bookmarks').update({status:'limited'}).eq('id',job.bookmark_id).eq('user_id',job.user_id);
   console.error('Knowledge job did not complete',{jobId:job.id,code,retry});
   return {state:limited?'limited':retry?'queued':'failed',code};
  }
 }));
 return {claimed:outcomes.length,complete:outcomes.filter(x=>x.state==='complete').length,failed:outcomes.filter(x=>x.state==='failed').length};
}
