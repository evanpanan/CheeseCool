import { revalidatePath } from 'next/cache';
import { createHash } from 'node:crypto';
import { after } from 'next/server';
import { apiUser,apiFailure,jsonBody,ApiError,bookmarkId } from '@/lib/knowledge-api';
import { normalizeTags,validEvidence } from '@/lib/knowledge-content';
import { canonical,identify,pastedUrl } from '@/lib/urls';
import { runKnowledgeJobs } from '@/lib/knowledge-jobs';
import { serviceDatabase } from '@/lib/supabase';
export const maxDuration=60;
export async function GET(request:Request){try{
 const {db}=await apiUser(request);const params=new URL(request.url).searchParams;
 if(params.get('format')==='export'){
  const {data:bookmarks,error}=await db.from('bookmarks').select('id,original_url,final_url,title,tags,notes,summary,ai_summary,content,source_hash,status,created_at,deleted_at').order('id').limit(501);
  if(error)throw error;if((bookmarks?.length||0)>500)throw new ApiError(413,'超过单次导出 500 条上限，请分批导出');
  const {data:sources,error:sourceError}=await db.from('bookmark_sources').select('bookmark_id,source_hash,source_url,raw_content,extracted_content,media_type,truncated,captured_at,origin').order('id').limit(1001);
  if(sourceError)throw sourceError;if((sources?.length||0)>1000)throw new ApiError(413,'来源版本超过单次导出上限');
  const {data:derivations,error:derivationError}=await db.from('bookmark_derivations').select('bookmark_id,source_hash,provider,model,prompt_version,summary,tags,evidence,created_at,origin').order('id').limit(1001);
  if(derivationError)throw derivationError;if((derivations?.length||0)>1000)throw new ApiError(413,'整理版本超过单次导出上限');
  const payload=JSON.stringify({format:'cheesecool-backup',version:1,exported_at:new Date().toISOString(),bookmarks,sources,derivations});
  if(Buffer.byteLength(payload)>10000000)throw new ApiError(413,'导出超过 10 MB，请分批备份');
  const encoder=new TextEncoder();const stream=new ReadableStream({start(controller){for(let offset=0;offset<payload.length;offset+=32000)controller.enqueue(encoder.encode(payload.slice(offset,offset+32000)));controller.close();}});
  return new Response(stream,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="cheesecool-backup.json"','Cache-Control':'no-store'}});
 }
 if(params.get('id')){
  const id=bookmarkId(params.get('id'));
  const {data:bookmark,error}=await db.from('bookmarks').select('id,title,original_url,final_url,tags,notes,status,summary,ai_summary,source_hash,deleted_at').eq('id',id).maybeSingle();
  if(error)throw error;if(!bookmark)throw new ApiError(404,'收藏不存在');
  const {data:sources}=await db.from('bookmark_sources').select('id,source_hash,source_url,media_type,truncated,captured_at,origin,extracted_content').eq('bookmark_id',id).order('captured_at',{ascending:false}).limit(20);
  const {data:derivations}=await db.from('bookmark_derivations').select('id,source_hash,provider,model,prompt_version,summary,tags,evidence,created_at,origin').eq('bookmark_id',id).order('created_at',{ascending:false}).limit(20);
  return Response.json({bookmark,sources,derivations},{headers:{'Cache-Control':'no-store'}});
 }
 const page=Math.max(0,Math.min(10000,Number(params.get('page'))||0));
 const query=db.from('bookmarks').select('id,title,original_url,tags,notes,status,deleted_at,created_at',{count:'exact'}).order('created_at',{ascending:false}).range(page*30,page*30+29);
 const {data,error,count}=await (params.get('trash')==='true'?query.not('deleted_at','is',null):query.is('deleted_at',null));
 if(error)throw error;return Response.json({bookmarks:data,total:count,page},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return apiFailure(e);}}
export async function POST(request:Request){try{
 const {db,user}=await apiUser(request,true);const body=await jsonBody(request);
 if(body.operation==='import'){
  const {data:allowed,error:quotaError}=await db.rpc('consume_knowledge_quota',{action_key:'import'});if(quotaError)throw quotaError;if(!allowed)throw new ApiError(429,'今日导入次数已达上限');
  const rows=body.bookmarks;if(!Array.isArray(rows)||rows.length>1)throw new ApiError(400,'每次请求可导入 1 条收藏，备份界面会自动分批');
  const prepared=rows.map((row:Record<string,unknown>)=>{if(!row||typeof row!=='object')throw new ApiError(400,'收藏格式无效');let url:URL;try{url=pastedUrl(String(row.original_url||row.url||''));}catch{throw new ApiError(400,'导入包含无效链接，请检查后重试');}return {original_url:url.href,canonical_url:canonical(url),platform:identify(url),title:String(row.title||url.hostname).slice(0,240),tags:normalizeTags(row.tags),notes:String(row.notes||'').slice(0,10000),user_edited_at:new Date().toISOString(),...(Array.isArray(row.tags)?{tags_edited_at:new Date().toISOString()}:{}),...(row.title?{title_edited_at:new Date().toISOString()}: {})};});
  const {data,error}=await db.from('bookmarks').upsert(prepared,{onConflict:'user_id,canonical_url',ignoreDuplicates:true}).select('id,original_url');if(error)throw error;
  const service=serviceDatabase();if(!service)throw new ApiError(503,'导入服务未配置');
  for(const inserted of data||[]){
   const index=prepared.findIndex(item=>item.original_url===inserted.original_url);const original=rows[index];
   if(typeof original?.content!=='string'||!original.content.trim())continue;
   const content=original.content.slice(0,120000),hash=createHash('sha256').update(content).digest('hex');
   const {error:restoreError}=await db.from('bookmarks').update({content,source_hash:hash,status:'extracted'}).eq('id',inserted.id);if(restoreError)throw restoreError;
   const snapshot=Array.isArray(body.sources)?body.sources.find((x:{bookmark_id?:string;extracted_content?:string})=>x.bookmark_id===original.id&&x.extracted_content===content):null;
   const raw=typeof snapshot?.raw_content==='string'?snapshot.raw_content:content;
   const {error:archiveError}=await service.from('bookmark_sources').upsert({user_id:user.id,bookmark_id:inserted.id,source_hash:hash,source_url:inserted.original_url,raw_content:raw.slice(0,1000000),extracted_content:content,media_type:'text/plain',origin:'import',truncated:raw.length>1000000},{onConflict:'bookmark_id,source_hash',ignoreDuplicates:true});
   if(archiveError)throw archiveError;
  }
  after(async()=>{await runKnowledgeJobs(user.id);});return Response.json({ok:true,imported:data?.length||0,duplicates:rows.length-(data?.length||0),inserted:data});
 }
 const id=bookmarkId(body.id);
 const {data:owned,error:readError}=await db.from('bookmarks').select('id,deleted_at,original_url').eq('id',id).maybeSingle();
 if(readError)throw readError;if(!owned)throw new ApiError(404,'收藏不存在');
 if(body.operation==='import_source'){
  const value=body.source;
  if(!value||typeof value.extracted_content!=='string'||typeof value.raw_content!=='string')throw new ApiError(400,'来源版本格式无效');
  const content=value.extracted_content.slice(0,120000),hash=createHash('sha256').update(content).digest('hex');
  const service=serviceDatabase();if(!service)throw new ApiError(503,'导入服务未配置');
  const {error}=await service.from('bookmark_sources').upsert({user_id:user.id,bookmark_id:id,source_hash:hash,source_url:pastedUrl(String(value.source_url||owned.original_url)).href,raw_content:value.raw_content.slice(0,1000000),extracted_content:content,media_type:'text/plain',origin:'import',truncated:value.raw_content.length>1000000,...(typeof value.captured_at==='string'&&Number.isFinite(Date.parse(value.captured_at))?{captured_at:new Date(value.captured_at).toISOString()}:{})},{onConflict:'bookmark_id,source_hash',ignoreDuplicates:true});if(error)throw error;
 }else if(body.operation==='import_derivation'){
  const value=body.derivation;if(!value||typeof value.summary!=='string'||typeof value.source_hash!=='string')throw new ApiError(400,'整理版本格式无效');
  const {data:source}=await db.from('bookmark_sources').select('extracted_content').eq('bookmark_id',id).eq('source_hash',value.source_hash).maybeSingle();
  if(!source)throw new ApiError(400,'整理版本缺少对应原文');
  const service=serviceDatabase();if(!service)throw new ApiError(503,'导入服务未配置');
  const {error}=await service.from('bookmark_derivations').insert({user_id:user.id,bookmark_id:id,source_hash:value.source_hash,provider:String(value.provider||'import').slice(0,40),model:String(value.model||'import').slice(0,100),prompt_version:String(value.prompt_version||'import').slice(0,100),summary:value.summary.slice(0,420),tags:normalizeTags(value.tags),evidence:validEvidence(source.extracted_content,value.evidence),origin:'import',...(typeof value.created_at==='string'&&Number.isFinite(Date.parse(value.created_at))?{created_at:new Date(value.created_at).toISOString()}:{})});if(error)throw error;
 }else if(body.operation==='update'){
  const patch:Record<string,unknown>={user_edited_at:new Date().toISOString()};
  if(typeof body.title==='string'&&body.title.trim()){patch.title=body.title.trim().slice(0,240);patch.title_edited_at=new Date().toISOString();}
  if(typeof body.notes==='string')patch.notes=body.notes.slice(0,10000);
  if(Array.isArray(body.tags)){patch.tags=normalizeTags(body.tags);patch.tags_edited_at=new Date().toISOString();}
  const {error}=await db.from('bookmarks').update(patch).eq('id',id);if(error)throw error;
  const service=serviceDatabase();if(service)await service.rpc('refresh_tag_edges',{owner_id:user.id});
 }else if(body.operation==='delete'||body.operation==='restore'){
  const {error}=await db.from('bookmarks').update({deleted_at:body.operation==='delete'?new Date().toISOString():null}).eq('id',id);if(error)throw error;
  const service=serviceDatabase();if(service)await service.rpc('refresh_tag_edges',{owner_id:user.id});
  if(body.operation==='restore')after(async()=>{await runKnowledgeJobs(user.id);});
 }else if(body.operation==='retry'||body.operation==='recapture'){
  if(owned.deleted_at)throw new ApiError(400,'请先从回收站恢复收藏');
  if(body.operation==='recapture'){
   const {data:job}=await db.from('bookmark_jobs').select('state,lease_until').eq('bookmark_id',id).maybeSingle();
   if(job?.state==='running'&&Date.parse(job.lease_until)>Date.now())throw new ApiError(409,'正在处理，请完成后再重新采集');
   const {error}=await db.from('bookmarks').update({status:'saved',content:null,source_hash:null,ai_summary:null,embedding:null}).eq('id',id);if(error)throw error;
  }
  const {data,error}=await db.rpc('retry_own_bookmark',{bookmark_id:id});if(error||!data)throw new ApiError(409,'任务正在运行');
  after(async()=>{await runKnowledgeJobs(user.id);});
 }else throw new ApiError(400,'未知操作');
 revalidatePath('/');revalidatePath('/network');revalidatePath('/manage');
 return Response.json({ok:true});
 }catch(e){return apiFailure(e);}}
