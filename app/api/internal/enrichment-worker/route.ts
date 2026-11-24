import {timingSafeEqual} from 'node:crypto';
import {runKnowledgeEnrichment} from '@/lib/knowledge-enrichment';
export const maxDuration=120;
export async function GET(request:Request){const secret=process.env.CRON_SECRET,received=request.headers.get('authorization')||'',expected='Bearer '+secret;if(!secret||Buffer.byteLength(received)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(received),Buffer.from(expected)))return new Response(null,{status:401});try{return Response.json(await runKnowledgeEnrichment());}catch{console.error('Knowledge enrichment worker unavailable');return Response.json({error:'自动分析暂不可用'},{status:503});}}
