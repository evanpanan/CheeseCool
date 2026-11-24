import {timingSafeEqual} from 'node:crypto';
import {runBackups} from '@/lib/knowledge-backups';
export const dynamic='force-dynamic';
export const maxDuration=240;
export async function GET(request:Request){const secret=process.env.CRON_SECRET,received=request.headers.get('authorization')||'',expected='Bearer '+secret;if(!secret||Buffer.byteLength(received)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(received),Buffer.from(expected)))return new Response(null,{status:401});try{return Response.json(await runBackups());}catch{return Response.json({error:'维护任务暂未完成'},{status:503});}}
