import {createHash,timingSafeEqual} from 'node:crypto';
import {siteAiConfig} from '@/lib/site-ai';
import {understand} from '@/lib/ai';
import {extract} from '@/lib/extract';
export const runtime='nodejs';export const maxDuration=120;
export async function POST(request:Request){
 const supplied=createHash('sha256').update((request.headers.get('authorization')||'').replace(/^Bearer /,'')).digest();
 const expected=Buffer.from('967f2a1d139eeb4508c7db1324458cf1883c3c269e1ddee73f90f126ff196670','hex');
 if(!timingSafeEqual(supplied,expected))return new Response(null,{status:404});
 const checks:string[]=[];
 try{
  const file=await extract(new URL('https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt'));
  if(file.completeness!=='repository_file'||!file.data?.content.includes('Apache'))throw new Error('public_file');checks.push('real_public_github_file');
  const issue=await extract(new URL('https://github.com/jsdom/jsdom/issues/1'));
  if(!/^issue(?:_partial)?$/.test(issue.completeness)||!issue.data?.content.includes('来源：'))throw new Error('public_issue');checks.push('real_public_github_issue');
  const config=await siteAiConfig();if(!config.chat)throw new Error('chat_unconfigured');
  const content='材料说明：芝士库保留原始网页和来源版本。当前只采集到部分讨论，不能据此判断全部参与者的观点。每条摘要必须有逐字原文证据。';
  const result=await understand('来源完整性验证',content,config.chat,4500,'partial');
  if(!result.evidence.length||!result.evidence.every(q=>content.includes(q))||! /^(根据|基于)(已采集|现有|部分|已获取)/.test(result.summary))throw new Error('summary_evidence');checks.push('real_model_scoped_grounded_summary');
  return Response.json({checks,provider:config.chat.provider,scope:issue.completeness});
 }catch(error){return Response.json({checks,failed:error instanceof Error?error.message:'unknown'},{status:500});}
}
