import {timingSafeEqual} from 'node:crypto';
import {serviceDatabase} from '@/lib/supabase';
import {runBackups} from '@/lib/knowledge-backups';
export const dynamic='force-dynamic';
export const maxDuration=240;
export async function GET(request:Request){const secret=process.env.CRON_SECRET,received=request.headers.get('authorization')||'',expected='Bearer '+secret;if(!secret||Buffer.byteLength(received)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(received),Buffer.from(expected)))return new Response(null,{status:401});try{const backups=await runBackups();const db=serviceDatabase();const incidents=await db?.rpc('check_knowledge_incidents');if(incidents?.error)throw incidents.error;return Response.json({backups,incidents:incidents?.data});}catch{return Response.json({error:'维护任务暂未完成'},{status:503});}}
