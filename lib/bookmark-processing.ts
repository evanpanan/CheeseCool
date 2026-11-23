import type { database } from './supabase';
import { canonical, webUrl } from './urls';
import { embed, embedMany, understand } from './ai';
import { siteAiConfig } from './site-ai';
import { chunkContent, normalizeTags } from './knowledge-content';
type Client = Awaited<ReturnType<typeof database>>;
export class ProcessingError extends Error {
 constructor(public code:string,message:string,public retryable=true){super(message);}
}
export async function processBookmark(db:Client,id:string,onStage:(stage:string)=>Promise<void>=async()=>{}) {
 const {data:row,error}=await db.from('bookmarks').select('*').eq('id',id).is('deleted_at',null).single();
 if(error||!row)throw new ProcessingError('not_found','收藏不存在或已删除',false);
 let source=row;
 await onStage('extract');
 if(!source.content||!source.source_hash){
  const {extract}=await import('./extract');
  const result=await extract(webUrl(source.original_url));
  if(!result.data)throw new ProcessingError('source_unavailable','链接已保存，但网站未提供可读取正文；可稍后重试或补充笔记',false);
  const key=canonical(webUrl(result.final_url));
  const {data:updated,error:updateError}=await db.from('bookmarks').update({...result.data,...(source.title_edited_at?{title:source.title}:{}),final_url:result.final_url,platform:result.platform,canonical_url:key,status:'extracted'})
   .eq('id',id).eq('user_id',row.user_id).is('deleted_at',null).select('*').single();
  if(updateError)throw new ProcessingError('extract_write','网页已读取，保存内容失败');
  source=updated;
  const {error:snapshotError}=await db.from('bookmark_sources').upsert({user_id:row.user_id,bookmark_id:id,source_hash:source.source_hash,source_url:result.final_url,
   raw_content:result.source?.raw||source.content,extracted_content:source.content,media_type:result.source?.mediaType||'text/plain',truncated:result.source?.truncated||false},
   {onConflict:'bookmark_id,source_hash',ignoreDuplicates:true});
  if(snapshotError)throw new ProcessingError('source_write','来源存档失败');
 }
 const {error:retentionError}=await db.from('bookmark_sources').upsert({user_id:row.user_id,bookmark_id:id,source_hash:source.source_hash,source_url:source.final_url||source.original_url,raw_content:source.content,extracted_content:source.content,media_type:'text/plain'}, {onConflict:'bookmark_id,source_hash',ignoreDuplicates:true});
 if(retentionError)throw new ProcessingError('source_write','来源存档失败');
 const chunks=chunkContent(source.content);
 const {data:existingChunks,error:chunkReadError}=await db.from('bookmark_chunks').select('id').eq('bookmark_id',id).eq('source_hash',source.source_hash).limit(1);
 if(chunkReadError)throw new ProcessingError('chunk_read','正文索引读取失败');
 if(!existingChunks?.length){
  const {error:chunkError}=await db.from('bookmark_chunks').upsert(chunks.map((content,ordinal)=>({user_id:row.user_id,bookmark_id:id,source_hash:source.source_hash,ordinal,content})),{onConflict:'bookmark_id,ordinal'});
  if(chunkError)throw new ProcessingError('chunk_write','正文分段索引失败');
 }
 await onStage('organize');
 const {chat,embeddingKey}=await siteAiConfig();
 if(!source.ai_summary&&!chat)return {waiting:true,reason:'model_unconfigured'};
 if(!source.ai_summary&&chat){
  let ai;
  try{ai=await understand(source.title,source.content,chat);}catch{throw new ProcessingError('model_unavailable','模型服务未完成整理，请检查模型名称、额度或稍后重试');}
  const {error:auditError}=await db.from('bookmark_derivations').insert({user_id:row.user_id,bookmark_id:id,source_hash:source.source_hash,provider:chat.provider,model:chat.model,prompt_version:'knowledge-v2',summary:ai.summary,tags:ai.tags,evidence:ai.evidence});
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
 if(embeddingKey&&!source.embedding){
  let vector;
  try{vector=await embed([source.title,source.ai_summary,source.tags.join(' '),source.content.slice(0,4500)].join('\n'),embeddingKey);}catch{throw new ProcessingError('embedding_unavailable','摘要已完成，语义索引服务暂不可用');}
  const {error:indexError}=await db.rpc('index_owned_bookmark',{bookmark_id:id,expected_hash:source.source_hash,new_embedding:JSON.stringify(vector)});
  if(indexError)throw new ProcessingError('index_write','语义关联保存失败');
 }
 if(embeddingKey){
  const {data:pendingChunks,error:pendingError}=await db.from('bookmark_chunks').select('id,content').eq('bookmark_id',id).eq('source_hash',source.source_hash).is('embedding',null).order('ordinal').limit(8);
  if(pendingError)throw new ProcessingError('chunk_read','正文索引读取失败');
  if(pendingChunks?.length){
   let vectors;try{vectors=await embedMany(pendingChunks.map(c=>c.content),embeddingKey);}catch{throw new ProcessingError('embedding_unavailable','摘要已完成，正文语义索引暂不可用');}
   await Promise.all(pendingChunks.map(async(chunk,i)=>{const {error}=await db.from('bookmark_chunks').update({embedding:JSON.stringify(vectors[i])}).eq('id',chunk.id).eq('source_hash',source.source_hash);if(error)throw new ProcessingError('index_write','正文索引保存失败');}));
   if(pendingChunks.length===8)return {waiting:true,reason:'index_pending'};
  }
 }
 return {waiting:false};
}
