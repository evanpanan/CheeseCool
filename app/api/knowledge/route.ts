import { apiUser,apiFailure,jsonBody,ApiError } from '@/lib/knowledge-api';
import { retrieveEvidence } from '@/lib/knowledge-retrieval';
import { siteAiConfig } from '@/lib/site-ai';
import { embed,answerFromEvidence } from '@/lib/ai';
export const maxDuration=60;
export async function POST(request:Request){try{
 const {db}=await apiUser(request,true),body=await jsonBody(request);
 const question=typeof body.question==='string'?body.question.trim():'';
 if(!question||question.length>240)throw new ApiError(400,'问题请控制在 240 字以内');
 const {data:allowed,error:quotaError}=await db.rpc('consume_knowledge_quota',{action_key:'answer'});if(quotaError)throw quotaError;if(!allowed)throw new ApiError(429,'本小时问答次数已用完，请稍后再试');
 const config=await siteAiConfig();
 const vector=config.embeddingKey?await embed(question,config.embeddingKey).catch(()=>null):null;
 const retrieval=await retrieveEvidence(db,question,vector),chunks=retrieval.sources;
 if(body.operation==='search')return Response.json(retrieval,{headers:{'Cache-Control':'no-store'}});
 if(!config.chat)throw new ApiError(503,'请先配置模型服务');
 if(!chunks.length)return Response.json({answer:'芝士库中暂未找到能支持这个问题的材料。',citations:[]});
 return Response.json({...await answerFromEvidence(question,chunks,config.chat),mode:retrieval.mode,ranking:retrieval.ranking},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return apiFailure(e);}}
