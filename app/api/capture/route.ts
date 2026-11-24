import {after} from 'next/server';
import {apiUser,apiFailure,jsonBody,ApiError} from '@/lib/knowledge-api';
import {canonical,webUrl} from '@/lib/urls';
import {runKnowledgeJobs} from '@/lib/knowledge-jobs';
export const maxDuration=240;
export async function POST(request:Request){try{
 const {db,user}=await apiUser(request,true),body=await jsonBody(request);let url:URL;try{url=webUrl(String(body.url||''));}catch{throw new ApiError(400,'来源链接无效');}
 if(typeof body.content!=='string'||body.content.trim().length<8||body.content.length>500000||typeof body.html!=='string'||Buffer.byteLength(body.html)>1500000)throw new ApiError(400,'采集正文为空或超过单次容量');
 const {data,error}=await db.rpc('capture_browser_document',{source_url:url.href,canonical:canonical(url),source_title:String(body.title||url.hostname).slice(0,240),source_text:body.content,source_html:body.html||body.content});if(error)throw new ApiError(409,'采集暂未保存，可能有同一材料正在处理；原文仍保留在当前页面');
 after(async()=>{await runKnowledgeJobs(user.id);});return Response.json({ok:true,id:data});
 }catch(e){return apiFailure(e);}}
