import { after } from 'next/server';
import type { database } from './supabase';
import { runKnowledgeJobs } from './knowledge-jobs';
type Client=Awaited<ReturnType<typeof database>>;
export async function scheduleBookmarkBackfill(db:Client,_wantEmbeddings:boolean){
 const {data:{user}}=await db.auth.getUser();if(!user)return false;
 const {data}=await db.from('bookmark_jobs').select('id,state,available_at').in('state',['queued','running','waiting']).lt('attempts',4).limit(20);
 if(!data?.length)return false;
 after(async()=>{try{await runKnowledgeJobs(user.id);}catch{console.error('Knowledge worker could not start');}});
 return data.some(j=>j.state==='running'||Date.parse(j.available_at)<=Date.now());
}
