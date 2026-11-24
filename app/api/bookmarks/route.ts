import {readOriginalBuffer,type OriginalAsset} from '@/lib/original-files';
import { revalidatePath } from 'next/cache';
import { createHash } from 'node:crypto';
import { after } from 'next/server';
import { apiUser,apiFailure,jsonBody,ApiError,bookmarkId } from '@/lib/knowledge-api';
import { normalizeTags,validEvidence } from '@/lib/knowledge-content';
import { canonical,identify,pastedUrl } from '@/lib/urls';
import { runKnowledgeJobs } from '@/lib/knowledge-jobs';
import { serviceDatabase } from '@/lib/supabase';
export const maxDuration=240;
export async function GET(request:Request){try{
 const {db}=await apiUser(request);const params=new URL(request.url).searchParams;
 if(params.get('format')==='export'){
  const {data:bookmarks,error}=await db.from('bookmarks').select('id,original_url,final_url,title,tags,notes,summary,ai_summary,content,source_hash,status,created_at,deleted_at,record_type,attributes').order('id').limit(501);
  if(error)throw error;if((bookmarks?.length||0)>500)throw new ApiError(413,'超过单次导出 500 条上限，请分批导出');
  const {data:sources,error:sourceError}=await db.from('bookmark_sources').select('bookmark_id,source_hash,source_url,raw_content,extracted_content,media_type,truncated,captured_at,origin,metadata').order('id').limit(1001);
  if(sourceError)throw sourceError;if((sources?.length||0)>1000)throw new ApiError(413,'来源版本超过单次导出上限');
  const {data:derivations,error:derivationError}=await db.from('bookmark_derivations').select('bookmark_id,source_hash,provider,model,prompt_version,summary,tags,evidence,created_at,origin,coverage').order('id').limit(1001);
  if(derivationError)throw derivationError;if((derivations?.length||0)>1000)throw new ApiError(413,'整理版本超过单次导出上限');
  const {data:assets,error:assetsError}=await db.from('bookmark_assets').select('*').order('id').limit(101);if(assetsError)throw assetsError;
  if((assets?.length||0)>100||(assets||[]).reduce((n,a)=>n+a.bytes,0)>6000000)throw new ApiError(413,'附件超过单次备份 6 MB 或 100 个上限，请分批备份');
  const service=serviceDatabase();const attachments=[];
  for(const asset of assets||[]){if(!service)throw new ApiError(503,'附件备份服务未配置');attachments.push({bookmark_id:asset.bookmark_id,filename:asset.filename,media_type:asset.media_type,sha256:asset.sha256,integrity_kind:asset.integrity_kind,data:(await readOriginalBuffer(asset as OriginalAsset)).toString('base64')});}
  const [{data:insights,error:insightError},{data:entities,error:entityError}]=await Promise.all([db.from('knowledge_insights').select('*').order('id').limit(501),db.from('knowledge_entities').select('*').order('id').limit(1001)]);
  if(insightError||entityError)throw insightError||entityError;if((insights?.length||0)>500||(entities?.length||0)>1000)throw new ApiError(413,'分析或实体档案超过单次备份上限');
  const payload=JSON.stringify({format:'cheesecool-backup',version:1,exported_at:new Date().toISOString(),bookmarks,sources,derivations,attachments,insights,entities});
  if(Buffer.byteLength(payload)>10000000)throw new ApiError(413,'导出超过 10 MB，请分批备份');
  const bytes=new TextEncoder().encode(payload);const stream=new ReadableStream({start(controller){for(let offset=0;offset<bytes.length;offset+=64000)controller.enqueue(bytes.subarray(offset,offset+64000));controller.close();}});
  return new Response(stream,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="cheesecool-backup.json"','Cache-Control':'no-store'}});
 }
 if(params.get('id')){
  const id=bookmarkId(params.get('id'));
  const {data:bookmark,error}=await db.from('bookmarks').select('id,title,original_url,final_url,tags,notes,status,summary,ai_summary,source_hash,deleted_at').eq('id',id).maybeSingle();
  if(error)throw error;if(!bookmark)throw new ApiError(404,'收藏不存在');
  const {data:sources}=await db.from('bookmark_sources').select('id,source_hash,source_url,media_type,truncated,captured_at,origin,extracted_content,metadata').eq('bookmark_id',id).order('captured_at',{ascending:false}).limit(20);
  const {data:derivations}=await db.from('bookmark_derivations').select('id,source_hash,provider,model,prompt_version,summary,tags,evidence,created_at,origin,coverage').eq('bookmark_id',id).order('created_at',{ascending:false}).limit(20);
  const {data:assets}=await db.from('bookmark_assets').select('id,filename,media_type,bytes').eq('bookmark_id',id);
  return Response.json({bookmark,sources,derivations,assets},{headers:{'Cache-Control':'no-store'}});
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
  const record=rows[0];
  if(record&&['note','journal','ai_conversation','meeting','knowledge_note','document','audio','video'].includes(record.record_type)){
   const content=typeof record.content==='string'?record.content:'';if(content.length>500000||(!content.trim()&&!['document','audio','video'].includes(record.record_type)))throw new ApiError(400,'记录备份缺少完整正文');
   const hash=createHash('sha256').update(content).digest('hex');
   const {data:existing}=await db.from('bookmarks').select('id').eq('record_type',record.record_type).eq('source_hash',hash).limit(1);
   if(content&&existing?.length)return Response.json({ok:true,imported:0,duplicates:1,inserted:[],resolved_id:existing[0].id});
   const snapshot=Array.isArray(body.sources)?body.sources.find((source:{extracted_content:string})=>source.extracted_content===content):null;
   const {data:id,error}=await db.rpc('create_knowledge_record',{record_kind:record.record_type,record_title:String(record.title||'导入记录').slice(0,240),record_content:content,record_raw:typeof snapshot?.raw_content==='string'?snapshot.raw_content:content,record_attributes:{...(record.attributes&&typeof record.attributes==='object'?record.attributes:{}),imported_from:record.original_url}});
   if(error)throw error;
   const {error:notesError}=await db.from('bookmarks').update({notes:String(record.notes||'').slice(0,10000),tags:normalizeTags(record.tags),tags_edited_at:new Date().toISOString(),title_edited_at:new Date().toISOString()}).eq('id',id);if(notesError)throw notesError;
   const service=serviceDatabase();if(service)await service.from('bookmark_sources').update({origin:'import',...(snapshot?{metadata:{original_metadata:snapshot.metadata||{},original_captured_at:snapshot.captured_at,original_source_url:snapshot.source_url}}:{})}).eq('bookmark_id',id).eq('user_id',user.id);
   after(async()=>{await runKnowledgeJobs(user.id);});return Response.json({ok:true,imported:1,duplicates:0,inserted:[{id}],resolved_id:id});
  }
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
   const {error:archiveError}=await service.from('bookmark_sources').upsert({user_id:user.id,bookmark_id:inserted.id,source_hash:hash,source_url:inserted.original_url,raw_content:raw.slice(0,1000000),extracted_content:content,media_type:'text/plain',origin:'import',metadata:{...(snapshot?.metadata&&typeof snapshot.metadata==='object'?snapshot.metadata:{}),original_captured_at:snapshot?.captured_at},truncated:raw.length>1000000},{onConflict:'bookmark_id,source_hash',ignoreDuplicates:true});
   if(archiveError)throw archiveError;
  }
  const resolved=data?.[0]||(await db.from('bookmarks').select('id').eq('canonical_url',prepared[0].canonical_url).maybeSingle()).data;
  after(async()=>{await runKnowledgeJobs(user.id);});return Response.json({ok:true,imported:data?.length||0,duplicates:rows.length-(data?.length||0),inserted:data,resolved_id:resolved?.id});
 }
 const id=bookmarkId(body.id);
 const {data:owned,error:readError}=await db.from('bookmarks').select('id,deleted_at,original_url,record_type,attributes').eq('id',id).maybeSingle();
 if(readError)throw readError;if(!owned)throw new ApiError(404,'收藏不存在');
 if(body.operation==='restore_links'){
  if(!owned.attributes?.imported_from)throw new ApiError(400,'仅可为刚导入的记录恢复引用');
  const ids=Array.isArray(body.source_ids)?[...new Set(body.source_ids.map(bookmarkId))]:[];
  const {data:parents}=await db.from('bookmarks').select('id').in('id',ids);
  if(parents?.length!==ids.length)throw new ApiError(400,'引用材料尚未恢复');
  const {error}=await db.from('bookmarks').update({attributes:{...owned.attributes,insight_id:null,original_insight_id:owned.attributes.insight_id||owned.attributes.original_insight_id,derived_from:ids}}).eq('id',id);if(error)throw error;
 }else if(body.operation==='import_source'){
  const value=body.source;
  if(!value||typeof value.extracted_content!=='string'||typeof value.raw_content!=='string')throw new ApiError(400,'来源版本格式无效');
  const content=value.extracted_content.slice(0,500000),hash=createHash('sha256').update(content).digest('hex');
  const service=serviceDatabase();if(!service)throw new ApiError(503,'导入服务未配置');
  const {error}=await service.from('bookmark_sources').upsert({user_id:user.id,bookmark_id:id,source_hash:hash,source_url:owned.record_type!=='web'?owned.original_url:pastedUrl(String(value.source_url||owned.original_url)).href,raw_content:value.raw_content.slice(0,1000000),extracted_content:content,media_type:'text/plain',origin:'import',metadata:value.metadata&&typeof value.metadata==='object'&&JSON.stringify(value.metadata).length<10000?value.metadata:{},truncated:value.raw_content.length>1000000,...(typeof value.captured_at==='string'&&Number.isFinite(Date.parse(value.captured_at))?{captured_at:new Date(value.captured_at).toISOString()}:{})},{onConflict:'bookmark_id,source_hash',ignoreDuplicates:true});if(error)throw error;
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
   if(owned.record_type!=='web')throw new ApiError(400,'这是一份受保护原件，修订请新建记录，不进行网页重新采集');
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
