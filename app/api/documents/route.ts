import {after} from 'next/server';
import {apiUser,apiFailure,jsonBody,bookmarkId,ApiError} from '@/lib/knowledge-api';
import {prepareRecord} from '@/lib/knowledge-records';
import {runKnowledgeJobs} from '@/lib/knowledge-jobs';
export const maxDuration=240;
export async function POST(request:Request){try{
 const {db,user}=await apiUser(request,true);const record=prepareRecord(await jsonBody(request));
 const {data,error}=await db.rpc('create_knowledge_record',{record_kind:record.kind,record_title:record.title,record_content:record.content,record_raw:record.raw,record_attributes:record.attributes});
 if(error)throw error;after(async()=>{await runKnowledgeJobs(user.id);});return Response.json({ok:true,id:data});
 }catch(e){return apiFailure(e);}}
export async function GET(request:Request){try{
 const {db}=await apiUser(request);const id=bookmarkId(new URL(request.url).searchParams.get('source'));
 const {data,error}=await db.from('bookmark_sources').select('raw_content,media_type,bookmark_id').eq('id',id).maybeSingle();
 if(error)throw error;if(!data)throw new ApiError(404,'原件不存在');
 const {data:parent}=await db.from('bookmarks').select('id').eq('id',data.bookmark_id).is('deleted_at',null).maybeSingle();if(!parent)throw new ApiError(404,'原件已移入回收站');
 return new Response(data.raw_content,{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="cheesecool-original.txt"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){return apiFailure(e);}}
