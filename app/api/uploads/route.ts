import {createHash} from 'node:crypto';
import {after} from 'next/server';
import {apiUser,apiFailure,jsonBody,bookmarkId,ApiError} from '@/lib/knowledge-api';
import {serviceDatabase} from '@/lib/supabase';
import {runKnowledgeJobs} from '@/lib/knowledge-jobs';
import {uploadPartSize,maxOriginalBytes} from '@/lib/original-files';
export const maxDuration=240;
export async function GET(request:Request){try{const {db}=await apiUser(request);const {data,error}=await db.from('knowledge_uploads').select('id,filename,bytes,parts,state,expires_at').eq('state','uploading').gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(30);if(error)throw error;return Response.json({uploads:(data||[]).map(u=>({id:u.id,filename:u.filename,bytes:u.bytes,done:u.parts.length,total:Math.ceil(u.bytes/uploadPartSize),expires_at:u.expires_at}))},{headers:{'Cache-Control':'no-store'}});}catch(e){return apiFailure(e);}}
export async function POST(request:Request){try{
 const {db,user}=await apiUser(request,true),body=await jsonBody(request),service=serviceDatabase();if(!service)throw new ApiError(503,'文件服务未配置');
 if(body.operation==='init'){
  const filename=typeof body.filename==='string'?body.filename.trim().slice(0,240):'',bytes=Number(body.bytes),ext=filename.split('.').pop()?.toLowerCase()||'';
  if(!filename||!Number.isSafeInteger(bytes)||bytes<=0||bytes>maxOriginalBytes||!['pdf','docx','txt','md','csv','json','mp3','wav','m4a','ogg','flac','aac','opus','mpga','mp4','webm','mov','mkv','mpeg','mpg'].includes(ext))throw new ApiError(400,'请选择支持格式的文件，单文件最大 200 MB');
  const {data:active,error:activeError}=await db.from('knowledge_uploads').select('bytes').eq('state','uploading').gt('expires_at',new Date().toISOString());if(activeError)throw activeError;
  const {data:assets,error:assetError}=await db.from('bookmark_assets').select('bytes');if(assetError)throw assetError;
  if((active?.length||0)>=4||(assets||[]).reduce((n,a)=>n+a.bytes,0)+(active||[]).reduce((n,u)=>n+u.bytes,0)+bytes>500000000)throw new ApiError(429,'待上传文件过多或已达到 500 MB 原件配额');
  const {data:bucket,error:bucketError}=await service.storage.getBucket('knowledge-originals');if(bucketError&&!bucket){const {error}=await service.storage.createBucket('knowledge-originals',{public:false,fileSizeLimit:12000000});if(error&&!/exist|duplicate/i.test(error.message))throw error;}
  else if(bucket&&(Number(bucket.file_size_limit||0)<12000000||bucket.public)){const {error}=await service.storage.updateBucket('knowledge-originals',{public:false,fileSizeLimit:12000000});if(error)throw error;}
  const kind=['mp3','wav','m4a','ogg','flac','aac','opus','mpga'].includes(ext)?'audio':['mp4','webm','mov','mkv','mpeg','mpg'].includes(ext)?'video':'document';
  const {data:id,error}=await db.rpc('create_knowledge_upload',{file_name:filename,file_bytes:bytes,file_type:String(body.media_type||'application/octet-stream').slice(0,160),record_kind:kind,want_diarization:body.diarize!==false});if(error)throw new ApiError(429,'上传任务过多或原件配额已满');
  const {data,error:readError}=await db.from('knowledge_uploads').select('id,parts,state,expires_at').eq('id',id).single();if(readError)throw readError;
  const count=Math.ceil(bytes/uploadPartSize);
  return Response.json({...data,part_size:uploadPartSize,part_count:count});
 }
 const id=bookmarkId(body.id),{data:upload,error}=await db.from('knowledge_uploads').select('*').eq('id',id).maybeSingle();if(error)throw error;if(!upload)throw new ApiError(404,'上传任务不存在');
 if(body.operation==='status')return Response.json({...upload,part_size:uploadPartSize,part_count:Math.ceil(upload.bytes/uploadPartSize)},{headers:{'Cache-Control':'no-store'}});
 if(body.operation==='cancel'){if(upload.state==='uploading'){const {error}=await service.from('knowledge_uploads').update({state:'cancelled'}).eq('id',id).eq('user_id',user.id);if(error)throw error;await service.from('bookmark_asset_gc').update({available_at:new Date().toISOString()}).like('object_path',`${user.id}/uploads/${id}/%`);}return Response.json({ok:true});}
 if(body.operation==='complete'){
  if(upload.state==='complete')return Response.json({ok:true,id:upload.bookmark_id});
  const manifest=createHash('sha256').update(JSON.stringify(upload.parts)).digest('hex');
  const {data:bookmark,error}=await db.rpc('finalize_knowledge_upload',{upload_id:id,manifest_hash:manifest});if(error)throw new ApiError(409,'部分分片尚未完整上传，或原件配额已用完，请检查上传进度');
  after(async()=>{await runKnowledgeJobs(user.id);});return Response.json({ok:true,id:bookmark});
 }
 if(upload.state!=='uploading'||Date.parse(upload.expires_at)<=Date.now())throw new ApiError(409,'上传任务已结束或过期');
 const ordinal=Number(body.ordinal);if(!Number.isSafeInteger(ordinal)||ordinal<0||ordinal>=Math.ceil(upload.bytes/uploadPartSize))throw new ApiError(400,'分片编号无效');
 if(body.operation==='part_done'){
  const hash=String(body.sha256||'');if(!/^[a-f0-9]{64}$/.test(hash))throw new ApiError(400,'分片校验值无效');const {error}=await db.rpc('register_knowledge_upload_part',{upload_id:id,part_number:ordinal,part_hash:hash});if(error)throw new ApiError(409,'分片未完整写入，请重试该分片');return Response.json({ok:true});
 }
 if(body.operation!=='sign')throw new ApiError(400,'未知上传操作');
 const path=`${user.id}/uploads/${id}/${ordinal}`;
 const {data:signed,error:signError}=await service.storage.from('knowledge-originals').createSignedUploadUrl(path,{upsert:false});if(signError)throw signError;
 return Response.json({url:signed.signedUrl,bytes:Math.min(uploadPartSize,upload.bytes-ordinal*uploadPartSize)},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return apiFailure(e);}}
