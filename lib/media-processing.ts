import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import type {serviceDatabase} from './supabase';
import {internalMediaSource,type OriginalAsset} from './original-files';
import {siteAiConfig} from './site-ai';
import {submitAliyunTranscript,pollAliyunTranscript,validateAliyunTranscript,TerminalAsrError} from './domestic-ai';
const run=promisify(execFile),segmentSeconds=300;
export type TranscriptSegment={start:number;end:number;speaker:string|null;text:string};
export function parseMediaDuration(stderr:string){
 const value=/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);if(!value)throw new Error('无法确定音视频时长');
 const duration=Number(value[1])*3600+Number(value[2])*60+Number(value[3]);if(!Number.isFinite(duration)||duration<=0||duration>14400)throw new Error('单个音视频支持最长 4 小时');return duration;
}
const inputOptions=['-hide_banner','-nostdin','-protocol_whitelist','http,https,tcp,tls,crypto','-format_whitelist','mov,mp3,wav,ogg,flac,matroska,webm,aac,mpeg,mpegts'];
export async function probeMedia(url:string){
 if(!ffmpegPath)throw new Error('媒体引擎未安装');
 try{const {stderr}=await run(ffmpegPath,[...inputOptions,'-i',url,'-map','0:a:0','-t','0','-f','null','-'],{timeout:45000,maxBuffer:1000000});return {duration:parseMediaDuration(stderr),mono:/Audio:[^\n]*\bmono\b/.test(stderr)};}catch(error){if(error instanceof Error&&/最长/.test(error.message))throw error;throw new Error('无法读取有效音轨或时长');}
}
export async function inspectMedia(url:string){return (await probeMedia(url)).duration;}
export async function prepareAudioSegment(url:string,offset:number,duration:number){
 if(!ffmpegPath)throw new Error('媒体引擎未安装');const dir=await mkdtemp(join(tmpdir(),'cheesecool-audio-')),file=join(dir,'part.flac');
 try{const {stderr}=await run(ffmpegPath,[...inputOptions,'-ss',String(offset),'-i',url,'-t',String(duration),'-map','0:a:0','-vn','-ac','1','-ar','16000','-af','volumedetect','-map_metadata','-1','-c:a','flac','-y',file],{timeout:60000,maxBuffer:1000000});
  const bytes=await readFile(file);if(!bytes.length||bytes.length>12000000)throw new Error('转写分片体积异常');
  const volume=/mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);return {bytes,silent:volume?Number(volume[1])<-75:false};
 }catch{throw new Error('音轨分片处理失败，原件已保留');}finally{await rm(dir,{recursive:true,force:true});}
}
export function validateTranscript(value:unknown,offset:number,duration:number,ordinal:number,diarize:boolean):TranscriptSegment[]{
 if(!value||typeof value!=='object')throw new Error('转写格式无效');const result=value as {text?:unknown;segments?:unknown};
 if(diarize){
  if(!Array.isArray(result.segments))throw new Error('转写缺少说话人片段');
  const segments=result.segments.map(s=>{if(!s||typeof s.text!=='string'||typeof s.speaker!=='string'||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<s.start||s.end>duration+2)throw new Error('转写时间戳无效');return {start:offset+s.start,end:offset+Math.min(duration,s.end),speaker:`片段${ordinal+1}·${s.speaker.slice(0,50)}`,text:s.text.trim()};}).filter(s=>s.text);
  if(segments.length>10000)throw new Error('说话人片段过多');if(!segments.length&&result.text!=='')throw new Error('转写未完整返回');return segments;
 }
 if(typeof result.text!=='string')throw new Error('转写缺少正文');return result.text.trim()?[{start:offset,end:offset+duration,speaker:null,text:result.text.trim()}]:[];
}
function timestamp(seconds:number){const s=Math.floor(seconds);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');}
export function formatTranscript(segments:TranscriptSegment[],diarize:boolean,singleTask=false){
 return (singleTask?'[说明：说话人为本次录音中的匿名标签，不代表实名身份。]\n\n':diarize?'[说明：说话人标签在各分段内识别，跨段不自动认定为同一人。]\n\n':'[说明：时间为分段范围，不是逐字时间戳。]\n\n')+segments.map(s=>`[${timestamp(s.start)}–${timestamp(s.end)}]${s.speaker?' '+s.speaker:''}\n${s.text}`).join('\n\n');
}
export async function processMedia(db:NonNullable<ReturnType<typeof serviceDatabase>>,asset:OriginalAsset,diarize:boolean){
 const config=await siteAiConfig();if(!config.asr)return {waiting:true as const,reason:'asr_unconfigured'};
 const service=config.asr;const model=service.provider==='aliyun'?service.model:diarize?(process.env.OPENAI_DIARIZATION_MODEL||'gpt-4o-transcribe-diarize'):service.model;
 const {data:bucket}=await db.storage.getBucket('knowledge-originals');if(bucket&&Number(bucket.file_size_limit||0)<12000000){const {error}=await db.storage.updateBucket('knowledge-originals',{public:false,fileSizeLimit:12000000});if(error)throw new Error('媒体存储尚未就绪');}
 const url=internalMediaSource(asset.id);let {data:steps,error}=await db.from('knowledge_asset_steps').select('*').eq('asset_id',asset.id).eq('kind','transcript').order('ordinal');if(error)throw new Error('转写进度读取失败');
 if(!steps?.length){const {duration,mono}=await probeMedia(url);const direct=service.provider==='aliyun'&&mono&&duration<=7200;const seconds=direct?duration:segmentSeconds;const planned=Array.from({length:Math.ceil(duration/seconds)},(_,ordinal)=>({user_id:asset.user_id,bookmark_id:asset.bookmark_id,asset_id:asset.id,kind:'transcript',ordinal,start_seconds:ordinal*seconds,duration_seconds:Math.min(seconds,duration-ordinal*seconds),provider:service.provider,model,...(direct?{state:'prepared',direct_original:true}:{})}));
  const {error}=await db.from('knowledge_asset_steps').upsert(planned,{onConflict:'asset_id,kind,ordinal',ignoreDuplicates:true});if(error)throw new Error('转写分段保存失败');const result=await db.from('knowledge_asset_steps').select('*').eq('asset_id',asset.id).eq('kind','transcript').order('ordinal');if(result.error)throw new Error('转写进度读取失败');steps=result.data;
 }
 const pending=steps!.filter(s=>s.state==='pending').slice(0,2);
 for(const step of pending){
  const result=await prepareAudioSegment(url,step.start_seconds,step.duration_seconds),path=`${asset.user_id}/${asset.bookmark_id}/derived/${asset.id}/${randomUUID()}.flac`,hash=createHash('sha256').update(result.bytes).digest('hex');
  const {error:gc}=await db.from('bookmark_asset_gc').insert({object_path:path,available_at:new Date(Date.now()+3600000).toISOString()});if(gc)throw new Error('转写分片暂存失败');
  const {error:upload}=await db.storage.from('knowledge-originals').upload(path,result.bytes,{contentType:'audio/flac',upsert:false});if(upload)throw new Error('转写分片上传失败');
  const {data:saved,error:save}=await db.from('knowledge_asset_steps').update({object_path:path,sha256:hash,bytes:result.bytes.length,state:result.silent?'complete':'prepared',text:result.silent?'[静音片段]':null,segments:result.silent?[{start:step.start_seconds,end:step.start_seconds+step.duration_seconds,speaker:null,text:'[静音片段]'}]:[],updated_at:new Date().toISOString()}).eq('id',step.id).eq('state','pending').select('id').maybeSingle();if(save)throw new Error('转写分片记录保存失败');if(saved)await db.from('bookmark_asset_gc').delete().eq('object_path',path);
 }
 const fresh=await db.from('knowledge_asset_steps').select('*').eq('asset_id',asset.id).eq('kind','transcript').order('ordinal');if(fresh.error)throw new Error('转写进度读取失败');steps=fresh.data!;
 if(pending.length){const {data:record}=await db.from('bookmarks').select('attributes').eq('id',asset.bookmark_id).single();const {error}=await db.from('bookmarks').update({attributes:{...record?.attributes,processing_progress:{stage:'prepare_audio',done:steps.filter(s=>s.state!=='pending').length,total:steps.length}}}).eq('id',asset.bookmark_id).eq('user_id',asset.user_id);if(error)throw new Error('音轨准备进度保存失败');return {waiting:true as const,reason:'media_pending'};}
 const prepared=steps.find(s=>s.state==='prepared');
 if(prepared){
  let segments:TranscriptSegment[]|null=null;
  if(service.provider==='aliyun'){
   if(prepared.remote_task_id){
    if(prepared.provider!==service.provider)throw new Error('当前分段的服务已切换，请恢复原服务后继续');
    try{if(Date.now()-Date.parse(prepared.updated_at)>86400000)throw new TerminalAsrError('转写任务已超时，重试时重新提交');const result=await pollAliyunTranscript(prepared.remote_task_id,service);if(!result.pending)segments=validateAliyunTranscript(result.value,prepared.start_seconds,prepared.duration_seconds,prepared.ordinal,diarize,prepared.direct_original);}catch(error){if(error instanceof TerminalAsrError){const cleared=await db.from('knowledge_asset_steps').update({remote_task_id:null,updated_at:new Date().toISOString()}).eq('id',prepared.id).eq('remote_task_id',prepared.remote_task_id);if(cleared.error)throw new Error('失败任务重置未完成');}throw error;}
   }else{
    const source=internalMediaSource(asset.id,prepared.direct_original?undefined:prepared.id,86400);const task=await submitAliyunTranscript(source,diarize,service);
    const {error}=await db.from('knowledge_asset_steps').update({remote_task_id:task,provider:service.provider,model,updated_at:new Date().toISOString()}).eq('id',prepared.id);if(error)throw new Error('转写任务编号保存失败');
   }
   if(segments===null)return {waiting:true as const,reason:'media_pending'};
  }else{
   const {data:file,error}=await db.storage.from('knowledge-originals').download(prepared.object_path);if(error||!file)throw new Error('转写分片暂时不可读取');const bytes=Buffer.from(await file.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==prepared.sha256)throw new Error('转写分片完整性校验失败');
   const form=new FormData();form.set('file',new File([bytes],'segment.flac',{type:'audio/flac'}));form.set('model',model);form.set('response_format',diarize?'diarized_json':'json');if(diarize)form.set('chunking_strategy','auto');
   const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+service.key},body:form,signal:AbortSignal.timeout(120000),redirect:'error'});if(!response.ok)throw new Error('转写服务暂不可用，请检查服务权限与额度');segments=validateTranscript(await response.json(),prepared.start_seconds,prepared.duration_seconds,prepared.ordinal,diarize);
  }
  const {error:save}=await db.from('knowledge_asset_steps').update({text:segments.map(s=>s.text).join('\n')||'[此段未识别到语音]',segments:segments.length?segments:[{start:prepared.start_seconds,end:prepared.start_seconds+prepared.duration_seconds,speaker:null,text:'[此段未识别到语音]'}],state:'complete',provider:service.provider,model:prepared.remote_task_id?prepared.model||model:model,updated_at:new Date().toISOString()}).eq('id',prepared.id);if(save)throw new Error('转写结果保存失败');
 }
 const final=await db.from('knowledge_asset_steps').select('*').eq('asset_id',asset.id).eq('kind','transcript').order('ordinal');if(final.error)throw new Error('转写进度读取失败');
 const complete=final.data!.filter(s=>s.state==='complete').length;
 await db.from('bookmarks').update({attributes:{...((await db.from('bookmarks').select('attributes').eq('id',asset.bookmark_id).single()).data?.attributes||{}),processing_progress:{stage:'transcribe',done:complete,total:final.data!.length}}}).eq('id',asset.bookmark_id).eq('user_id',asset.user_id);
 if(complete!==final.data!.length)return {waiting:true as const,reason:'media_pending'};
 const segments=final.data!.flatMap(s=>s.segments as TranscriptSegment[]);if(!segments.some(s=>!s.text.startsWith('[')))throw new Error('完整录音中未识别到语音，原件已保留');
 return {waiting:false as const,text:formatTranscript(segments,diarize,final.data!.length===1&&final.data![0].direct_original),method:'asr',attributes:{transcript_scope:diarize?(final.data!.length===1&&final.data![0].direct_original?'single-task-speakers':'segment-local-speakers'):'segment-time-ranges',transcript_segments:segments.length,original_asset_id:asset.id,processing_progress:{stage:'transcribe',done:complete,total:complete},transcription_models:[...new Set(final.data!.map(s=>s.model))]}};
}
