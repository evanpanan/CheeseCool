import { timingSafeEqual } from 'node:crypto';
import { runKnowledgeJobs } from '@/lib/knowledge-jobs';
export const maxDuration=60;
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;
 const received=request.headers.get('authorization')||'';
 const expected=secret?`Bearer ${secret}`:'';
 if(!secret||Buffer.byteLength(received)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(received),Buffer.from(expected)))return Response.json({error:'Unauthorized'},{status:401});
 try{return Response.json(await runKnowledgeJobs());}catch{return Response.json({error:'Worker temporarily unavailable'},{status:503});}
}
