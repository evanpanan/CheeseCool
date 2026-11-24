import {randomUUID,createHash} from 'node:crypto';
import {after} from 'next/server';
import {apiUser,apiFailure,bookmarkId,ApiError} from '@/lib/knowledge-api';
import {serviceDatabase} from '@/lib/supabase';
import {runKnowledgeJobs} from '@/lib/knowledge-jobs';
import {originalResponse,type OriginalAsset} from '@/lib/original-files';
export const maxDuration=240;
export async function POST(request:Request){try{
 const {db,user}=await apiUser(request,true);if(Number(request.headers.get('content-length')||0)>3200000)throw new ApiError(413,'单个文件最多 3 MB');
 const form=await request.formData(),file=form.get('file');if(!(file instanceof File)||!file.size||file.size>3000000)throw new ApiError(400,'请选择 3 MB 以内的文件');
 const ext=file.name.split('.').pop()?.toLowerCase()||'',audio=['mp3','wav','m4a','ogg','flac','aac','opus','mpga'],video=['mp4','webm','mov','mkv','mpeg','mpg'];
 if(!['pdf','docx','txt','md','csv','json',...audio,...video].includes(ext))throw new ApiError(400,'暂不支持此文件格式');
 const service=serviceDatabase();if(!service)throw new ApiError(503,'文件服务未配置');
 const kind=audio.includes(ext)?'audio':video.includes(ext)?'video':'document';
 const {data:bucket}=await service.storage.getBucket('knowledge-originals');
 if(!bucket){const {error}=await service.storage.createBucket('knowledge-originals',{public:false,fileSizeLimit:3000000});if(error&&!/exist|duplicate/i.test(error.message))throw error;}
 let id:string;const existing=form.get('bookmark_id');
 if(existing){id=bookmarkId(existing);const {data}=await db.from('bookmarks').select('id').eq('id',id).is('deleted_at',null).maybeSingle();if(!data)throw new ApiError(404,'收藏不存在');}
 else{const {data,error}=await db.rpc('create_knowledge_record',{record_kind:kind,record_title:file.name.slice(0,240),record_content:'',record_raw:'',record_attributes:{filename:file.name,size:file.size}});if(error)throw error;id=data;}
 const bytes=Buffer.from(await file.arrayBuffer()),hash=createHash('sha256').update(bytes).digest('hex');
 const {data:known}=await db.from('bookmark_assets').select('id').eq('bookmark_id',id).eq('sha256',hash).maybeSingle();if(known)return Response.json({ok:true,id,duplicate:true});
 const path=`${user.id}/${id}/${randomUUID()}.${ext}`;
 const {error:stagingError}=await service.from('bookmark_asset_gc').insert({object_path:path,available_at:new Date(Date.now()+3600000).toISOString()});if(stagingError)throw stagingError;
 const {error:uploadError}=await service.storage.from('knowledge-originals').upload(path,bytes,{contentType:'application/octet-stream',upsert:false});if(uploadError)throw uploadError;
 const {error:insertError}=await service.from('bookmark_assets').insert({user_id:user.id,bookmark_id:id,object_path:path,filename:file.name.slice(0,240),media_type:file.type||'application/octet-stream',sha256:hash,bytes:bytes.length});
 if(insertError){await service.storage.from('knowledge-originals').remove([path]);throw insertError;}
 await service.from('bookmark_asset_gc').delete().eq('object_path',path);
 await db.rpc('retry_own_bookmark',{bookmark_id:id});after(async()=>{await runKnowledgeJobs(user.id);});return Response.json({ok:true,id});
 }catch(e){return apiFailure(e);}}
export async function GET(request:Request){try{
 const {db}=await apiUser(request),id=bookmarkId(new URL(request.url).searchParams.get('id'));
 const {data:asset,error}=await db.from('bookmark_assets').select('*').eq('id',id).maybeSingle();if(error)throw error;if(!asset)throw new ApiError(404,'原始文件不存在');
 const {data:record}=await db.from('bookmarks').select('id').eq('id',asset.bookmark_id).is('deleted_at',null).maybeSingle();if(!record)throw new ApiError(404,'文件已移入回收站');
 try{return await originalResponse(asset as OriginalAsset,request.headers.get('range'));}catch{throw new ApiError(416,'文件范围无效');}
 }catch(e){return apiFailure(e);}}
