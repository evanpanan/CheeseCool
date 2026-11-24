import {randomUUID} from 'node:crypto';
import {apiUser,apiFailure,jsonBody,ApiError,bookmarkId} from '@/lib/knowledge-api';
import {advancedRetrieve,type ConversationTurn} from '@/lib/advanced-retrieval';
import {siteAiConfig} from '@/lib/site-ai';
import {answerFromEvidence} from '@/lib/ai';
import {serviceDatabase} from '@/lib/supabase';
export const maxDuration=120;
export async function GET(request:Request){try{const {db}=await apiUser(request),id=new URL(request.url).searchParams.get('id');if(id){const {data,error}=await db.from('knowledge_conversations').select('*').eq('id',bookmarkId(id)).maybeSingle();if(error)throw error;if(!data)throw new ApiError(404,'对话不存在');return Response.json({conversation:data},{headers:{'Cache-Control':'no-store'}});}const {data,error}=await db.from('knowledge_conversations').select('id,title,version,updated_at').order('updated_at',{ascending:false}).limit(50);if(error)throw error;return Response.json({conversations:data},{headers:{'Cache-Control':'no-store'}});}catch(e){return apiFailure(e);}}
export async function DELETE(request:Request){try{const {db}=await apiUser(request,true),body=await jsonBody(request);const {error}=await db.from('knowledge_conversations').delete().eq('id',bookmarkId(body.id));if(error)throw error;return Response.json({ok:true});}catch(e){return apiFailure(e);}}
export async function POST(request:Request){const started=Date.now();try{
 const {db,user}=await apiUser(request,true),body=await jsonBody(request),question=typeof body.question==='string'?body.question.trim():'';
 if(!question||question.length>240)throw new ApiError(400,'问题请控制在 240 字以内');const searchOnly=body.operation==='search';let conversationId:string=randomUUID(),version=0,history:ConversationTurn[]=[];
 if(body.conversation_id){conversationId=bookmarkId(body.conversation_id);const {data,error}=await db.from('knowledge_conversations').select('version,turns').eq('id',conversationId).maybeSingle();if(error)throw error;if(!data)throw new ApiError(404,'对话不存在');version=data.version;history=data.turns;if(version>=20)throw new ApiError(409,'这段对话已有 20 轮，请开启新对话');if(body.expected_version!==undefined&&body.expected_version!==version)throw new ApiError(409,'对话已更新，请重新打开后继续');}
 const {data:allowed,error:quotaError}=await db.rpc('consume_knowledge_quota',{action_key:'answer'});if(quotaError)throw quotaError;if(!allowed)throw new ApiError(429,'本小时问答次数已用完，请稍后再试');
 const config=await siteAiConfig();if(!searchOnly&&!config.chat)throw new ApiError(503,'请先配置模型服务');const retrieval=await advancedRetrieve(db,question,history,config,searchOnly);
 const answer=searchOnly?null:retrieval.sources.length?await answerFromEvidence(retrieval.standalone,retrieval.sources,config.chat!):{answer:'芝士库中暂未找到能支持这个问题的材料。',citations:[]};
 const service=serviceDatabase();if(service){const event=await service.from('knowledge_query_events').insert({user_id:user.id,mode:retrieval.mode,ranking:retrieval.ranking,query_count:retrieval.queries.length,candidate_count:retrieval.candidate_count,citation_count:answer?.citations.length||0,duration_ms:Date.now()-started,degraded:retrieval.degraded});if(event.error)console.warn('Query metrics not recorded');}
 if(searchOnly)return Response.json(retrieval,{headers:{'Cache-Control':'no-store'}});
 const {data:next,error:appendError}=await db.rpc('append_knowledge_conversation',{conversation:conversationId,expected_version:version,question,answer:answer!.answer,citations:answer!.citations});if(appendError)throw appendError;if(!next)throw new ApiError(409,'对话或引用原文已变化，请重新查询');
 return Response.json({...answer,conversation_id:conversationId,version:next,mode:retrieval.mode,ranking:retrieval.ranking,query_count:retrieval.queries.length,plan_status:retrieval.plan_status,rerank_status:retrieval.rerank_status,degraded:retrieval.degraded},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return apiFailure(e);}}
