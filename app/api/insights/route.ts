import {apiUser,apiFailure,jsonBody,bookmarkId,ApiError} from '@/lib/knowledge-api';
import {siteAiConfig} from '@/lib/site-ai';
import {serviceDatabase} from '@/lib/supabase';
import {analyzeSources} from '@/lib/ai';
export const maxDuration=60;
export async function GET(request:Request){try{const {db}=await apiUser(request);const [insights,entities]=await Promise.all([db.from('knowledge_insights').select('*').order('created_at',{ascending:false}).limit(50),db.from('knowledge_entities').select('*').order('confirmed_at',{ascending:false}).limit(100)]);if(insights.error||entities.error)throw insights.error||entities.error;return Response.json({insights:insights.data,entities:entities.data},{headers:{'Cache-Control':'no-store'}});}catch(e){return apiFailure(e);}}
export async function POST(request:Request){try{
 const {db,user}=await apiUser(request,true),body=await jsonBody(request),service=serviceDatabase();if(!service)throw new ApiError(503,'分析服务未配置');
 if(body.operation==='import_draft'||body.operation==='import_entity'){
  const value=body.value;if(!value||typeof value!=='object')throw new ApiError(400,'档案格式无效');
  const ids=Array.isArray(value.source_ids)?[...new Set(value.source_ids.map(bookmarkId))] as string[]:[];
  if(!ids.length||ids.length>50)throw new ApiError(400,'档案缺少来源引用');const {data:parents}=await db.from('bookmarks').select('id,content,source_hash').in('id',ids);if(parents?.length!==ids.length)throw new ApiError(400,'请先恢复所有来源材料');
  if(body.operation==='import_entity'){
   if(typeof value.name!=='string'||typeof value.description!=='string'||!['person','organization','project','concept'].includes(value.kind))throw new ApiError(400,'实体格式无效');
   const {error}=await service.from('knowledge_entities').upsert({user_id:user.id,name:value.name.normalize('NFKC').trim().slice(0,120),kind:value.kind,description:value.description.slice(0,500),source_ids:ids,origin:'import'},{onConflict:'user_id,name,kind',ignoreDuplicates:true});if(error)throw error;
  }else{
   const evidence=(Array.isArray(value.evidence)?value.evidence:[]).flatMap((entry:{source_id:string;quote:string})=>{const parent=parents.find(p=>p.id===entry.source_id);return parent&&typeof entry.quote==='string'&&entry.quote.length>=8&&parent.content?.includes(entry.quote)?[{source_id:parent.id,source_hash:parent.source_hash,quote:entry.quote}]:[];});
   const {error}=await service.from('knowledge_insights').insert({user_id:user.id,title:String(value.title||'导入分析').slice(0,200),body:String(value.body||'').slice(0,4000),source_ids:ids,evidence,entities:[],provider:String(value.provider||'unknown').slice(0,40),model:String(value.model||'unknown').slice(0,100),state:'draft',origin:'import'});if(error)throw error;
  }
  return Response.json({ok:true});
 }
 if(body.operation==='analyze'){
  const ids=Array.isArray(body.ids)?[...new Set(body.ids.map(bookmarkId))]:[];if(!ids.length||ids.length>6)throw new ApiError(400,'每次请选择 1 至 6 份完整材料');
  const {data:sources,error}=await db.from('bookmarks').select('id,title,content,source_hash').is('deleted_at',null).in('id',ids);
  if(error)throw error;if(sources?.length!==ids.length||sources.some(s=>!s.content||!s.source_hash))throw new ApiError(400,'部分材料不存在或还没有完整正文');
  if(sources.reduce((n,s)=>n+s.content.length,0)>22000)throw new ApiError(400,'完整材料超过本次 22000 字符分析上限，请分组处理；不会截断后冒充完整分析');
  const {data:allowed}=await db.rpc('consume_knowledge_quota',{action_key:'answer'});if(!allowed)throw new ApiError(429,'本小时分析与问答额度已用完');
  const config=await siteAiConfig();if(!config.chat)throw new ApiError(503,'请先配置模型');
  const result=await analyzeSources(sources.map(s=>({id:s.id,title:s.title,content:s.content,hash:s.source_hash})),String(body.question||'提炼共识、差异与可复用观点').slice(0,500),config.chat);
  const {data,error:writeError}=await service.from('knowledge_insights').insert({user_id:user.id,source_ids:ids,provider:config.chat.provider,model:config.chat.model,...result}).select('id').single();if(writeError)throw writeError;
  return Response.json({ok:true,id:data.id,state:'draft'});
 }
 const id=bookmarkId(body.id);const {data:insight,error}=await db.from('knowledge_insights').select('*').eq('id',id).maybeSingle();if(error)throw error;if(!insight)throw new ApiError(404,'分析不存在');
 if(body.operation==='reject'){
  const {error}=await service.from('knowledge_insights').update({state:'rejected'}).eq('id',id).eq('user_id',user.id).eq('state','draft');if(error)throw error;return Response.json({ok:true});
 }
 if(body.operation!=='confirm')throw new ApiError(400,'未知操作');
 if(insight.state!=='draft')throw new ApiError(409,'这份分析已处理');
 const {data:sources}=await db.from('bookmarks').select('id,source_hash').is('deleted_at',null).in('id',insight.source_ids);
 if(!sources||sources.length!==insight.source_ids.length||insight.evidence.some((e:{source_id:string;source_hash:string})=>!sources.some(s=>s.id===e.source_id&&s.source_hash===e.source_hash)))throw new ApiError(409,'来源已改变，请重新分析后确认');
 // Publication and confirmed entity writes are performed atomically with ownership checks in SQL.
 const {data,error:confirmError}=await db.rpc('confirm_knowledge_insight',{insight_id:id});if(confirmError)throw confirmError;if(!data)throw new ApiError(409,'这份分析已处理');
 return Response.json({ok:true,bookmark_id:data});
 }catch(e){return apiFailure(e);}}
