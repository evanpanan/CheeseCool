import {apiUser,apiFailure,jsonBody,bookmarkId,ApiError} from '@/lib/knowledge-api';
export async function GET(request:Request){try{
 const {db}=await apiUser(request),id=new URL(request.url).searchParams.get('id');
 if(id){const entityId=bookmarkId(id),{data:entity,error}=await db.from('knowledge_entities').select('*').eq('id',entityId).maybeSingle();if(error)throw error;if(!entity)throw new ApiError(404,'实体不存在');const {data:aliases}=await db.from('knowledge_entities').select('id').eq('merged_into',entityId);const {data:revisions,error:revError}=await db.from('knowledge_entity_revisions').select('*').in('entity_id',[entityId,...(aliases||[]).map(a=>a.id)]).order('created_at',{ascending:false}).limit(100);if(revError)throw revError;return Response.json({entity,revisions},{headers:{'Cache-Control':'no-store'}});}
 const [entities,updates,conflicts]=await Promise.all([db.from('knowledge_entities').select('*').is('merged_into',null).order('confirmed_at',{ascending:false}).limit(200),db.from('knowledge_entity_updates').select('*').eq('state','pending').order('created_at',{ascending:false}).limit(100),db.from('bookmark_relation_analyses').select('id,source_id,target_id,source_hash,target_hash,reason,evidence,created_at').eq('kind','contradict').eq('review_state','pending').order('created_at',{ascending:false}).limit(50)]);
 if(entities.error||updates.error||conflicts.error)throw entities.error||updates.error||conflicts.error;return Response.json({entities:entities.data,updates:updates.data,conflicts:conflicts.data},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return apiFailure(e);}}
export async function POST(request:Request){try{
 const {db}=await apiUser(request,true),body=await jsonBody(request);
 if(body.operation==='merge'){
  const from=bookmarkId(body.from_id),into=bookmarkId(body.into_id);if(from===into||!Number.isInteger(body.from_version)||!Number.isInteger(body.into_version))throw new ApiError(400,'请选择两个实体的当前版本');
  const {data,error}=await db.rpc('merge_knowledge_entities',{from_entity:from,into_entity:into,from_version:body.from_version,into_version:body.into_version});if(error)throw error;if(!data)throw new ApiError(409,'实体或来源已改变，请刷新后重新核对');return Response.json({ok:true,id:data});
 }
 if(body.operation==='review_update'){
  const id=bookmarkId(body.id);if(typeof body.accept!=='boolean')throw new ApiError(400,'请选择接受或拒绝');const {data,error}=await db.rpc('review_entity_update',{update_id:id,accept_change:body.accept});if(error)throw error;if(!data)throw new ApiError(409,'这份变更的实体或原文版本已改变，请刷新后重新分析');return Response.json({ok:true});
 }
 if(body.operation==='review_relation'){
  const id=bookmarkId(body.id);if(!['confirmed','rejected'].includes(body.decision))throw new ApiError(400,'请选择确认或拒绝');const {data,error}=await db.rpc('review_knowledge_relation',{analysis_id:id,decision:body.decision});if(error)throw error;if(!data)throw new ApiError(409,'关联原文已改变或已处理，请刷新');return Response.json({ok:true});
 }
 throw new ApiError(400,'未知实体操作');
 }catch(e){return apiFailure(e);}}
