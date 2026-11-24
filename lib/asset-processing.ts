import type {serviceDatabase} from './supabase';
import {siteAiConfig} from './site-ai';
import {parseDocumentFile} from './document-files';
import {readOriginalBuffer,type OriginalAsset} from './original-files';
import {processPdf} from './pdf-processing';
import {processMedia} from './media-processing';
import type {ServiceConfig} from './capability-services';
import {aliyunOcr} from './domestic-ai';
export class AssetError extends Error{constructor(public code:string,message:string,public waiting=false){super(message);}}
export async function extractAsset(db:NonNullable<ReturnType<typeof serviceDatabase>>,bookmarkId:string,ownerId:string,kind:string){
 const {data:asset,error}=await db.from('bookmark_assets').select('*').eq('bookmark_id',bookmarkId).eq('user_id',ownerId).order('created_at',{ascending:false}).limit(1).maybeSingle();
 if(error||!asset)throw new AssetError('asset_pending','原件尚在上传，稍后继续');
 if(kind==='audio'||kind==='video'){
  const {data:record}=await db.from('bookmarks').select('attributes').eq('id',bookmarkId).single();
  try{const result=await processMedia(db,asset as OriginalAsset,record?.attributes?.diarize===true);if(result.waiting)throw new AssetError(result.reason,result.reason==='asr_unconfigured'?'音视频原件已保存，等待配置语音转写服务':'正在分段处理音视频',true);return {...result,asset};}
  catch(error){if(error instanceof AssetError)throw error;throw new AssetError('media_processing',error instanceof Error?error.message:'媒体处理失败');}
 }
 if(asset.filename.toLowerCase().endsWith('.pdf')){
  try{const result=await processPdf(db,asset as OriginalAsset,ocrPdf);if(result.waiting)throw new AssetError(result.reason,result.reason==='ocr_unconfigured'?'扫描页已保留，等待配置 OCR 服务':'正在逐页识别扫描文档',true);return {...result,asset};}
  catch(error){if(error instanceof AssetError)throw error;throw new AssetError('document_parse',error instanceof Error?error.message:'PDF 解析失败');}
 }
 const bytes=await readOriginalBuffer(asset as OriginalAsset);
 try{const result=await parseDocumentFile(bytes,asset.filename);return {text:result.text,asset,method:'document'};}
 catch(e){const message=e instanceof Error?e.message:'文件解析失败';if(message.includes('OCR')){const {embeddingKey:key}=await siteAiConfig();if(!key)throw new AssetError('ocr_unconfigured','扫描文档原件已保存，等待配置 OpenAI OCR 服务',true);return {text:await ocrPdf(bytes,asset.filename,key),asset,method:'ocr'};}throw new AssetError('document_parse',message);}
}

export async function ocrPdf(bytes:Buffer,filename:string,key:string,config?:ServiceConfig){
 if(config?.provider==='aliyun')return aliyunOcr(bytes,config);
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:config?.model||process.env.OPENAI_OCR_MODEL||'gpt-4.1-mini',max_output_tokens:8000,input:[{role:'user',content:[{type:'input_text',text:'逐字提取此 PDF 每页的全部文字，保留页码和段落。不要概括、润色或补写。无法辨认处标记[无法辨认]。只返回提取的正文。'},{type:'input_file',filename,file_data:'data:application/pdf;base64,'+bytes.toString('base64')}]}]}),signal:AbortSignal.timeout(40000),redirect:'error'});
 if(!response.ok)throw new AssetError('ocr_unavailable','OCR 服务暂不可用，请检查额度或稍后重试');
 const result=await response.json();if(result.status!=='completed')throw new AssetError('ocr_too_large','原件已保存，此文档超出单次 OCR 输出容量，请拆分后处理');
 const text=(result.output||[]).flatMap((item:{content?:{type?:string;text?:string}[]})=>(item.content||[]).filter(c=>c.type==='output_text').map(c=>c.text||'')).join('\n');
 if(!text.trim())throw new AssetError('ocr_empty','OCR 未提取到文字');return text;
}
