import {apiUser,apiFailure} from '@/lib/knowledge-api';
import {serviceDatabase} from '@/lib/supabase';
import {isAiAdmin} from '@/lib/ai-admin';
export async function GET(request:Request){try{const {user}=await apiUser(request),db=serviceDatabase();if(!db)throw new Error('服务未配置');const owner=new URL(request.url).searchParams.get('scope')==='site'&&isAiAdmin(user.id)?null:user.id;const {data,error}=await db.rpc('knowledge_health_summary',{owner_id:owner});if(error)throw error;return Response.json({scope:owner?'account':'site',metrics:data},{headers:{'Cache-Control':'no-store'}});}catch(e){return apiFailure(e);}}
