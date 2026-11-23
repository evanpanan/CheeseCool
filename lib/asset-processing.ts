import type {serviceDatabase} from './supabase';
import {siteAiConfig} from './site-ai';
import {parseDocumentFile} from './document-files';
export class AssetError extends Error{constructor(public code:string,message:string,public waiting=false){super(message);}}
export async function extractAsset(db:NonNullable<ReturnType<typeof serviceDatabase>>,bookmarkId:string,ownerId:string,kind:string){
 const {data:asset,error}=await db.from('bookmark_assets').select('*').eq('bookmark_id',bookmarkId).eq('user_id',ownerId).order('created_at',{ascending:false}).limit(1).maybeSingle();
 if(error||!asset)throw new AssetError('asset_pending','原件尚在上传，稍后继续');
 const {data:file,error:downloadError}=await db.storage.from('knowledge-originals').download(asset.object_path);
 if(downloadError||!file)throw new AssetError('asset_download','原件暂时无法读取');
 const bytes=Buffer.from(await file.arrayBuffer());
 if(kind==='audio'||kind==='video'){
  const {embeddingKey:key}=await siteAiConfig();if(!key)throw new AssetError('asr_unconfigured','音视频原件已保存，等待配置 OpenAI 转写服务',true);
  const form=new FormData();form.set('file',new File([bytes],asset.filename,{type:asset.media_type}));form.set('model','gpt-4o-mini-transcribe');form.set('response_format','json');
  const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:AbortSignal.timeout(40000),redirect:'error'});
  if(!response.ok)throw new AssetError('asr_unavailable','语音转写服务暂不可用，请检查额度或稍后重试');
  const value=await response.json();if(typeof value.text!=='string'||!value.text.trim())throw new AssetError('asr_empty','未识别到语音正文');
  return {text:value.text,asset,method:'asr'};
 }
 try{const result=await parseDocumentFile(bytes,asset.filename);return {text:result.text,asset,method:'document'};}
 catch(e){const message=e instanceof Error?e.message:'文件解析失败';if(message.includes('OCR')){const {embeddingKey:key}=await siteAiConfig();if(!key)throw new AssetError('ocr_unconfigured','扫描文档原件已保存，等待配置 OpenAI OCR 服务',true);return {text:await ocrPdf(bytes,asset.filename,key),asset,method:'ocr'};}throw new AssetError('document_parse',message);}
}

export async function ocrPdf(bytes:Buffer,filename:string,key:string){
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',max_output_tokens:8000,input:[{role:'user',content:[{type:'input_text',text:'逐字提取此 PDF 每页的全部文字，保留页码和段落。不要概括、润色或补写。无法辨认处标记[无法辨认]。只返回提取的正文。'},{type:'input_file',filename,file_data:'data:application/pdf;base64,'+bytes.toString('base64')}]}]}),signal:AbortSignal.timeout(40000),redirect:'error'});
 if(!response.ok)throw new AssetError('ocr_unavailable','OCR 服务暂不可用，请检查额度或稍后重试');
 const result=await response.json();if(result.status!=='completed')throw new AssetError('ocr_too_large','原件已保存，此文档超出单次 OCR 输出容量，请拆分后处理');
 const text=(result.output||[]).flatMap((item:{content?:{type?:string;text?:string}[]})=>(item.content||[]).filter(c=>c.type==='output_text').map(c=>c.text||'')).join('\n');
 if(!text.trim())throw new AssetError('ocr_empty','OCR 未提取到文字');return text;
}
