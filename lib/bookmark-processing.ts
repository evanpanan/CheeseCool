import { createHash } from 'node:crypto';
import { extractAsset, AssetError } from './asset-processing';
import type { database } from './supabase';
import { canonical, webUrl } from './urls';
import { embed, embedMany, understand } from './ai';
import { siteAiConfig } from './site-ai';
import { chunkContent, normalizeTags, validEvidence } from './knowledge-content';
type Client = Awaited<ReturnType<typeof database>>;
export class ProcessingError extends Error {
 constructor(public code:string,message:string,public retryable=true){super(message);}
}
export async function processBookmark(db:Client,id:string,onStage:(stage:string)=>Promise<void>=async()=>{}) {
 const {data:row,error}=await db.from('bookmarks').select('*').eq('id',id).is('deleted_at',null).single();
 if(error||!row)throw new ProcessingError('not_found','收藏不存在或已删除',false);
 let source=row;
 await onStage('extract');
 if((!source.content||!source.source_hash)&&['document','audio','video'].includes(source.record_type)){
  let result;
  try{result=await extractAsset(db,id,row.user_id,source.record_type);}catch(error){if(error instanceof AssetError){if(error.waiting){await db.from('bookmarks').update({attributes:{...source.attributes,processing_wait:error.code}}).eq('id',id).eq('user_id',row.user_id);return {waiting:true,reason:error.code};}throw new ProcessingError(error.code,error.message,!['document_parse','asr_empty','ocr_empty','ocr_too_large'].includes(error.code));}throw error;}
  if(result.text.length>500000)throw new ProcessingError('document_too_large','原件已保留，正文超过单条 50 万字符上限，请拆分处理',false);
  const hash=createHash('sha256').update(result.text).digest('hex');
  const {data:updated,error:updateError}=await db.from('bookmarks').update({content:result.text,source_hash:hash,status:'extracted',attributes:{...source.attributes,...('attributes' in result?result.attributes:{}),extraction_method:result.method,processing_wait:null}}).eq('id',id).eq('user_id',row.user_id).is('deleted_at',null).select('*').single();
  if(updateError)throw new ProcessingError('extract_write','原件已保存，提取文本保存失败');source=updated;
 }
 if(!source.content||!source.source_hash){
  const {extract}=await import('./extract');
  const result=await extract(webUrl(source.original_url));
  if(!result.data)throw new ProcessingError('source_unavailable','链接已保存，但网站未提供可读取正文；可稍后重试或补充笔记',false);
  const key=canonical(webUrl(result.final_url));
  const {data:updated,error:updateError}=await db.from('bookmarks').update({...result.data,...(source.title_edited_at?{title:source.title}:{}),final_url:result.final_url,platform:result.platform,canonical_url:key,status:'extracted',attributes:{...source.attributes,capture_level:result.completeness}})
   .eq('id',id).eq('user_id',row.user_id).is('deleted_at',null).select('*').single();
  if(updateError)throw new ProcessingError('extract_write','网页已读取，保存内容失败');
  source=updated;
  const {error:snapshotError}=await db.from('bookmark_sources').upsert({user_id:row.user_id,bookmark_id:id,source_hash:source.source_hash,source_url:result.final_url,
   raw_content:result.source?.raw||source.content,extracted_content:source.content,media_type:result.source?.mediaType||'text/plain',truncated:result.source?.truncated||false,metadata:{title:result.data.title,original_url:row.original_url,capture_level:result.completeness}},
   {onConflict:'bookmark_id,source_hash',ignoreDuplicates:true});
  if(snapshotError)throw new ProcessingError('source_write','来源存档失败');
 }
 const {error:retentionError}=await db.from('bookmark_sources').upsert({user_id:row.user_id,bookmark_id:id,source_hash:source.source_hash,source_url:source.final_url||source.original_url,raw_content:source.content,extracted_content:source.content,media_type:'text/plain',origin:source.record_type==='web'?'web':'user',metadata:{title:source.title,record_type:source.record_type,attributes:source.attributes}}, {onConflict:'bookmark_id,source_hash',ignoreDuplicates:true});
 if(retentionError)throw new ProcessingError('source_write','来源存档失败');
 const chunks=chunkContent(source.content);
 const {data:existingChunks,error:chunkReadError}=await db.from('bookmark_chunks').select('id').eq('bookmark_id',id).eq('source_hash',source.source_hash).limit(1);
 if(chunkReadError)throw new ProcessingError('chunk_read','正文索引读取失败');
 if(!existingChunks?.length){
  const {error:chunkError}=await db.from('bookmark_chunks').upsert(chunks.map((content,ordinal)=>({user_id:row.user_id,bookmark_id:id,source_hash:source.source_hash,ordinal,content})),{onConflict:'bookmark_id,ordinal'});
  if(chunkError)throw new ProcessingError('chunk_write','正文分段索引失败');
 }
 await onStage('organize');
 const {chat,embedding:embeddingKey}=await siteAiConfig();
 if(!source.ai_summary&&!chat)return {waiting:true,reason:'model_unconfigured'};
 if(!source.ai_summary&&chat){
  let ai;
  const pieces=chunkContent(source.content,4500,250);
  if(pieces.length>1){
   const {data:known,error:pieceReadError}=await db.from('bookmark_piece_summaries').select('ordinal,summary,tags,evidence').eq('bookmark_id',id).eq('source_hash',source.source_hash).eq('provider',chat.provider).eq('model',chat.model).eq('prompt_version','piece-v1').order('ordinal');
   if(pieceReadError)throw new ProcessingError('piece_read','分段整理记录读取失败');
   const done=new Set((known||[]).map(p=>p.ordinal));const missing=pieces.map((text,ordinal)=>({text,ordinal})).filter(p=>!done.has(p.ordinal)).slice(0,3);
   if(missing.length){
    await Promise.all(missing.map(async piece=>{
     let result;try{result=await understand(source.title+' · 第 '+(piece.ordinal+1)+' 段',piece.text,chat);}catch{throw new ProcessingError('model_unavailable','长文分段整理暂未完成，已保留完成的分段');}
     const {error}=await db.from('bookmark_piece_summaries').upsert({user_id:row.user_id,bookmark_id:id,source_hash:source.source_hash,ordinal:piece.ordinal,provider:chat.provider,model:chat.model,prompt_version:'piece-v1',...result},{onConflict:'bookmark_id,source_hash,ordinal,provider,model,prompt_version',ignoreDuplicates:true});
     if(error)throw new ProcessingError('piece_write','分段整理记录保存失败');
    }));
    return {waiting:true,reason:'organize_pending'};
   }
   if(known?.length!==pieces.length)throw new ProcessingError('piece_incomplete','长文分段尚未全部整理');
   const combined=known.map(p=>'第 '+(p.ordinal+1)+' 段：'+p.summary.slice(0,180)).join('\n');
   try{ai=await understand(source.title,combined,chat,26000);}catch{throw new ProcessingError('model_unavailable','分段已完成，最终汇总暂未完成');}
   ai.evidence=validEvidence(source.content,known.flatMap(p=>p.evidence||[]));
  }else{
   try{ai=await understand(source.title,source.content,chat);}catch{throw new ProcessingError('model_unavailable','模型服务未完成整理，请检查模型名称、额度或稍后重试');}
  }
  const {error:auditError}=await db.from('bookmark_derivations').insert({user_id:row.user_id,bookmark_id:id,source_hash:source.source_hash,provider:chat.provider,model:chat.model,prompt_version:'knowledge-v3',summary:ai.summary,tags:ai.tags,evidence:ai.evidence,coverage:{characters:source.content.length,parts:pieces.length,complete:true}});
  if(auditError)throw new ProcessingError('derivation_write','模型输出存档失败');
  const {data:saved,error:summaryError}=await db.from('bookmarks').update({ai_summary:ai.summary,...(!source.tags_edited_at?{tags:ai.tags}:{})}).eq('id',id).eq('source_hash',source.source_hash).is('ai_summary',null).is('deleted_at',null).select('id').maybeSingle();
  if(summaryError)throw new ProcessingError('summary_write','摘要保存失败');
  if(!saved)return {waiting:false};
  source={...source,ai_summary:ai.summary,tags:source.tags_edited_at?source.tags:ai.tags};
 }
 if(!source.tags_edited_at){const tags=normalizeTags(source.tags);if(JSON.stringify(tags)!==JSON.stringify(source.tags))await db.from('bookmarks').update({tags}).eq('id',id).eq('source_hash',source.source_hash);}
 const {error:tagError}=await db.rpc('refresh_tag_edges',{owner_id:row.user_id});
 if(tagError)throw new ProcessingError('relations_write','标签关联保存失败');
 await onStage('index');
 if(embeddingKey&&(!source.embedding||source.embedding_space!==embeddingKey.space)){
  let vector;
  try{vector=await embed([source.title,source.ai_summary,source.tags.join(' '),source.content.slice(0,4500)].join('\n'),embeddingKey);}catch{throw new ProcessingError('embedding_unavailable','摘要已完成，语义索引服务暂不可用');}
  const {error:indexError}=await db.rpc('index_owned_bookmark_v2',{bookmark_id:id,expected_hash:source.source_hash,new_embedding:JSON.stringify(vector),new_space:embeddingKey.space});
  if(indexError)throw new ProcessingError('index_write','语义关联保存失败');
 }
 if(embeddingKey){
  const {data:pendingChunks,error:pendingError}=await db.from('bookmark_chunks').select('id,content').eq('bookmark_id',id).eq('source_hash',source.source_hash).or('embedding.is.null,embedding_space.neq.'+embeddingKey.space).order('ordinal').limit(8);
  if(pendingError)throw new ProcessingError('chunk_read','正文索引读取失败');
  if(pendingChunks?.length){
   let vectors;try{vectors=await embedMany(pendingChunks.map(c=>c.content),embeddingKey);}catch{throw new ProcessingError('embedding_unavailable','摘要已完成，正文语义索引暂不可用');}
   await Promise.all(pendingChunks.map(async(chunk,i)=>{const {error}=await db.from('bookmark_chunks').update({embedding:JSON.stringify(vectors[i]),embedding_space:embeddingKey.space}).eq('id',chunk.id).eq('source_hash',source.source_hash);if(error)throw new ProcessingError('index_write','正文索引保存失败');}));
   if(pendingChunks.length===8)return {waiting:true,reason:'index_pending'};
  }
 }
 return {waiting:false};
}
