import {apiUser,apiFailure,ApiError} from '@/lib/knowledge-api';
import {isAiAdmin} from '@/lib/ai-admin';
import {readServiceHealth,startServiceHealth} from '@/lib/service-health';
export const maxDuration=240;
export async function GET(request:Request){try{const {user}=await apiUser(request);if(!isAiAdmin(user.id))throw new ApiError(404,'页面不存在');return Response.json({checks:await readServiceHealth()},{headers:{'Cache-Control':'no-store'}});}catch(e){return apiFailure(e);}}
export async function POST(request:Request){try{const {user}=await apiUser(request,true);if(!isAiAdmin(user.id))throw new ApiError(404,'页面不存在');return Response.json({checks:await startServiceHealth()},{headers:{'Cache-Control':'no-store'}});}catch(e){return apiFailure(e);}}
