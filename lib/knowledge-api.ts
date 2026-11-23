import { database } from './supabase';
export class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
export async function apiUser(request:Request,write=false){
 if(write&&request.headers.get('origin')!==new URL(request.url).origin)throw new ApiError(403,'请求来源无效');
 const db=await database();const {data:{user},error}=await db.auth.getUser();
 if(error||!user)throw new ApiError(401,'请先登录');return {db,user};
}
export async function jsonBody(request:Request){
 if(Number(request.headers.get('content-length')||0)>2000000)throw new ApiError(413,'导入内容不能超过 2 MB');
 const raw=await request.text();if(raw.length>2000000)throw new ApiError(413,'请求过大');
 try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new ApiError(400,'JSON 格式无效');}
}
export function apiFailure(error:unknown){if(!(error instanceof ApiError))console.error('Knowledge API failed',{type:error instanceof Error?error.name:'database_error'});return Response.json({error:error instanceof ApiError?error.message:'操作暂时未完成，请稍后重试'}, {status:error instanceof ApiError?error.status:503});}
export function bookmarkId(value:unknown){if(typeof value!=='string'||!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value))throw new ApiError(400,'收藏编号无效');return value;}
