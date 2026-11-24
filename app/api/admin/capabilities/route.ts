import {apiUser,apiFailure,jsonBody,ApiError} from '@/lib/knowledge-api';
import {isAiAdmin} from '@/lib/ai-admin';
import {serviceDatabase} from '@/lib/supabase';
import {encryptKey,encryptionKey} from '@/lib/ai-settings';
import {validAliyunHost} from '@/lib/capability-services';
export async function GET(request:Request){try{const {user}=await apiUser(request);if(!isAiAdmin(user.id))throw new ApiError(404,'页面不存在');const db=serviceDatabase();if(!db)throw new ApiError(503,'服务未配置');const {data,error}=await db.from('site_capability_settings').select('*').eq('id',true).maybeSingle();if(error)throw error;return Response.json({provider:data?.provider||'aliyun',host:data?.aliyun_host||'dashscope.aliyuncs.com',embedding_model:data?.embedding_model||'',ocr_model:data?.ocr_model||'',asr_model:data?.asr_model||'',rerank_model:data?.rerank_model||'',key_configured:Boolean(data?.aliyun_key||process.env.DASHSCOPE_API_KEY)},{headers:{'Cache-Control':'no-store'}});}catch(e){return apiFailure(e);}}
export async function POST(request:Request){try{
 const {user}=await apiUser(request,true);if(!isAiAdmin(user.id))throw new ApiError(404,'页面不存在');const body=await jsonBody(request),provider=body.provider;
 if(!['aliyun','openai'].includes(provider))throw new ApiError(400,'服务商无效');const host=String(body.host||'dashscope.aliyuncs.com').trim();if(!validAliyunHost(host))throw new ApiError(400,'请使用百炼北京地域或业务空间的服务域名，不含 https:// 和路径');
 const models=['embedding_model','ocr_model','asr_model','rerank_model'];for(const field of models)if(body[field]&&!/^[\w./:-]{1,100}$/.test(body[field]))throw new ApiError(400,'模型名称无效');
 const patch:Record<string,unknown>={id:true,provider,aliyun_host:host};for(const field of models)patch[field]=String(body[field]||'').trim()||null;
 if(body.key){const key=String(body.key).trim(),root=encryptionKey();if(!root||key.length>512||/\s/.test(key))throw new ApiError(400,'密钥无效或服务端加密尚未配置');patch.aliyun_key=encryptKey(key,root,'aliyun-services');}else if(body.remove_key===true)patch.aliyun_key=null;
 const db=serviceDatabase();if(!db)throw new ApiError(503,'服务未配置');const {error}=await db.from('site_capability_settings').upsert(patch,{onConflict:'id',defaultToNull:false});if(error)throw error;
 await db.from('bookmark_jobs').update({state:'queued',attempts:0,available_at:new Date().toISOString()}).in('state',['waiting','failed']).in('error_code',['asr_unconfigured','ocr_unconfigured','asr_unavailable','embedding_unavailable','media_processing']);
 return Response.json({ok:true});
 }catch(e){return apiFailure(e);}}
