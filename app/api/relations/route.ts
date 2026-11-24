import {apiUser,apiFailure,jsonBody,bookmarkId,ApiError} from '@/lib/knowledge-api';
import {siteAiConfig} from '@/lib/site-ai';
import {serviceDatabase} from '@/lib/supabase';
import {analyzeRelation} from '@/lib/ai';
import {sharedTopics,relationExcerpts,relationPromptVersion,type RelationSource} from '@/lib/knowledge-relations';
export const maxDuration=60;
export async function POST(request:Request){try{
 const {db,user}=await apiUser(request,true),input=await jsonBody(request);
 const ids=[bookmarkId(input.source_id).toLowerCase(),bookmarkId(input.target_id).toLowerCase()].sort();if(ids[0]===ids[1])throw new ApiError(400,'请选择两份不同的材料');
 const {data,error}=await db.from('bookmarks').select('id,title,content,source_hash,tags').in('id',ids).is('deleted_at',null);
 if(error)throw error;if(data?.length!==2)throw new ApiError(404,'关联材料不存在');
 const sources=ids.map(id=>{const row=data.find(s=>s.id===id)!;return {...row,content:row.content||'',source_hash:row.source_hash||'',tags:row.tags||[]};}) as RelationSource[];
 const topics=sharedTopics(...sources as [RelationSource,RelationSource]);
 const {data:edge}=await db.from('bookmark_edges').select('kind,score').eq('source_id',ids[0]).eq('target_id',ids[1]).maybeSingle();
 const basis={kind:edge?.kind|| (topics.length?'tag':'none'),shared_tags:topics,similarity:edge?.kind==='semantic'?edge.score:null,reason:topics.length?'共同主题：'+topics.join('、'):edge?.kind==='semantic'?'向量语义相似；尚不代表存在确定的事实关系':'当前尚无已建立的关联'};
 const provenance=sources.map(s=>({id:s.id,title:s.title,source_hash:s.source_hash,archive_url:s.source_hash?'/document/'+s.id+'?version='+encodeURIComponent(s.source_hash):null}));
 const {data:cached,error:cacheReadError}=await db.from('bookmark_relation_analyses').select('id,kind,reason,evidence,provider,model,created_at,review_state').eq('source_id',ids[0]).eq('target_id',ids[1]).eq('source_hash',sources[0].source_hash||'').eq('target_hash',sources[1].source_hash||'').eq('prompt_version',relationPromptVersion).order('created_at',{ascending:false}).limit(1).maybeSingle();
 if(cacheReadError)throw cacheReadError;
 const base={basis,sources:provenance,scope:'excerpts',analysis_status:'model_proposed'};
 if(cached)return Response.json({...base,analysis:cached,analysis_status:cached.review_state==='confirmed'?'user_confirmed':cached.review_state==='rejected'?'user_rejected':'model_proposed',cached:true},{headers:{'Cache-Control':'no-store'}});
 if(input.analyze!==true)return Response.json({...base,analysis:null,excerpts:sources.map(s=>({source_id:s.id,content:relationExcerpts(s,sources.find(t=>t.id!==s.id)!)}))},{headers:{'Cache-Control':'no-store'}});
 if(sources.some(s=>!s.source_hash||!s.content))throw new ApiError(409,'部分原文还未读取完成');
 const config=await siteAiConfig();if(!config.chat)throw new ApiError(503,'请先配置模型服务');
 const {data:allowed,error:quotaError}=await db.rpc('consume_knowledge_quota',{action_key:'answer'});if(quotaError)throw quotaError;if(!allowed)throw new ApiError(429,'本小时分析次数已用完');
 let analysis;try{analysis=await analyzeRelation(sources,config.chat);}catch{throw new ApiError(422,'未得到双方都有原文依据的关联分析，请稍后重试');}
 const {data:current}=await db.from('bookmarks').select('id,source_hash').in('id',ids).is('deleted_at',null);if(current?.length!==2||sources.some(s=>!current.some(c=>c.id===s.id&&c.source_hash===s.source_hash)))throw new ApiError(409,'原文已改变，请重新分析');
 const service=serviceDatabase();if(!service)throw new ApiError(503,'关联分析存档服务未配置');
 const row={user_id:user.id,source_id:ids[0],target_id:ids[1],source_hash:sources[0].source_hash,target_hash:sources[1].source_hash,provider:config.chat.provider,model:config.chat.model,prompt_version:relationPromptVersion,...analysis};
 const {data:saved,error:writeError}=await service.from('bookmark_relation_analyses').upsert(row,{onConflict:'user_id,source_id,target_id,source_hash,target_hash,provider,model,prompt_version'}).select('id,kind,reason,evidence,provider,model,created_at,review_state').single();if(writeError)throw writeError;
 return Response.json({...base,analysis:saved,cached:false},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return apiFailure(e);}}
