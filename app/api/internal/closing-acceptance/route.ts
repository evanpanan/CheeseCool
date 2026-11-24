import {createHash,timingSafeEqual} from 'node:crypto';
import {productionClosing} from '@/tests/helpers/production-closing';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request){const supplied=createHash('sha256').update((request.headers.get('authorization')||'').replace(/^Bearer /,'')).digest();if(!timingSafeEqual(supplied,Buffer.from('ac3debafd04c0a9fba311973b3c3cf07c79f5b3dbecdc18899b557e9160922e4','hex')))return new Response(null,{status:404});const result=await productionClosing(new URL(request.url).origin);return Response.json(result,{status:result.ok?200:500});}
