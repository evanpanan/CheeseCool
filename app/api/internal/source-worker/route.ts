import {timingSafeEqual} from 'node:crypto';
import {runSourceTasks} from '@/lib/source-lifecycle';
import {serviceDatabase} from '@/lib/supabase';
export const maxDuration=120;
export async function GET(request:Request){const received=request.headers.get('authorization')||'',secret=process.env.CRON_SECRET,expected='Bearer '+secret;if(!secret||Buffer.byteLength(received)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(received),Buffer.from(expected)))return new Response(null,{status:401});try{const db=serviceDatabase();if(!db)throw new Error();const due=await db.rpc('enqueue_due_source_refreshes');if(due.error)throw due.error;return Response.json(await runSourceTasks());}catch{console.error('Source maintenance unavailable');return Response.json({error:'来源维护暂不可用'},{status:503});}}
