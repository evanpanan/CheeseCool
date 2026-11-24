import type {serviceDatabase} from './supabase';
import {readOriginalBuffer,type OriginalAsset} from './original-files';
import {siteAiConfig} from './site-ai';
import type {ServiceConfig} from './capability-services';
export async function inspectPdfPages(bytes:Buffer){
 const {getDocumentProxy,getResolvedPDFJS}=await import('unpdf');const pdf=await getDocumentProxy(new Uint8Array(bytes),{maxImageSize:16777216});
 try{if(pdf.numPages>200)throw new Error('单个 PDF 最多 200 页');const {OPS}=await getResolvedPDFJS();const paint=new Set(Object.entries(OPS).filter(([key])=>/paint.*Image|constructPath/.test(key)).map(([,value])=>value));const pages=[];
  for(let ordinal=0;ordinal<pdf.numPages;ordinal++){const page=await pdf.getPage(ordinal+1);const content=await page.getTextContent();const text=content.items.flatMap(item=>'str' in item?[item.str]:[]).join(' ').trim();let needsOcr=false;
   if(!text){const operators=await page.getOperatorList();needsOcr=operators.fnArray.some(op=>paint.has(op));}pages.push({ordinal,text,needsOcr});page.cleanup();
  }return pages;
 }finally{await pdf.loadingTask.destroy();}
}
export async function extractPdfPage(bytes:Buffer,ordinal:number){
 const {PDFDocument}=await import('pdf-lib');const original=await PDFDocument.load(bytes),single=await PDFDocument.create();if(ordinal<0||ordinal>=original.getPageCount())throw new Error('PDF 页码无效');const [page]=await single.copyPages(original,[ordinal]);single.addPage(page);const output=Buffer.from(await single.save());if(output.length>20000000)throw new Error('单页 PDF 超过 20 MB OCR 上限，原件已保留');return output;
}
export async function processPdf(db:NonNullable<ReturnType<typeof serviceDatabase>>,asset:OriginalAsset,ocr:(bytes:Buffer,name:string,key:string,config?:ServiceConfig)=>Promise<string>){
 let {data:steps,error}=await db.from('knowledge_asset_steps').select('*').eq('asset_id',asset.id).eq('kind','ocr').order('ordinal');if(error)throw new Error('PDF 处理进度读取失败');
 let bytes:Buffer|undefined;
 if(!steps?.length){bytes=await readOriginalBuffer(asset);const pages=await inspectPdfPages(bytes);
  const {error}=await db.from('knowledge_asset_steps').upsert(pages.map(page=>({user_id:asset.user_id,bookmark_id:asset.bookmark_id,asset_id:asset.id,kind:'ocr',ordinal:page.ordinal,state:page.needsOcr?'pending':'complete',text:page.needsOcr?null:page.text||'[空白页]',provider:page.needsOcr?'openai':'pdf-text',model:page.needsOcr?process.env.OPENAI_OCR_MODEL||'gpt-4.1-mini':'unpdf-2.2.2'})),{onConflict:'asset_id,kind,ordinal',ignoreDuplicates:true});if(error)throw new Error('PDF 分页记录保存失败');
  const fresh=await db.from('knowledge_asset_steps').select('*').eq('asset_id',asset.id).eq('kind','ocr').order('ordinal');if(fresh.error)throw new Error('PDF 处理进度读取失败');steps=fresh.data;
 }
 const pending=steps!.filter(s=>s.state!=='complete');
 if(pending.length){const config=await siteAiConfig();if(!config.ocr)return {waiting:true as const,reason:'ocr_unconfigured'};bytes||=await readOriginalBuffer(asset);
  for(const page of pending.slice(0,2)){const file=await extractPdfPage(bytes,page.ordinal),text=await ocr(file,`page-${page.ordinal+1}.pdf`,config.ocr.key,config.ocr);const {error}=await db.from('knowledge_asset_steps').update({state:'complete',text,provider:config.ocr.provider,model:config.ocr.model,updated_at:new Date().toISOString()}).eq('id',page.id);if(error)throw new Error('OCR 分页结果保存失败');}
 }
 const final=await db.from('knowledge_asset_steps').select('*').eq('asset_id',asset.id).eq('kind','ocr').order('ordinal');if(final.error)throw new Error('PDF 处理进度读取失败');
 const complete=final.data!.filter(s=>s.state==='complete').length,progress={stage:'ocr',done:complete,total:final.data!.length};
 const {data:record}=await db.from('bookmarks').select('attributes').eq('id',asset.bookmark_id).single();const {error:progressError}=await db.from('bookmarks').update({attributes:{...record?.attributes,processing_progress:progress}}).eq('id',asset.bookmark_id).eq('user_id',asset.user_id);if(progressError)throw new Error('PDF 进度保存失败');
 if(complete!==final.data!.length)return {waiting:true as const,reason:'ocr_pending'};
 return {waiting:false as const,text:final.data!.map(page=>`[第 ${page.ordinal+1} 页]\n${page.text}`).join('\n\n'),method:final.data!.some(p=>p.provider==='openai'||p.provider==='aliyun')?'page-ocr':'pdf-text',attributes:{original_asset_id:asset.id,pdf_pages:final.data!.length,processing_progress:progress,extraction_coverage:{pages:final.data!.length,complete:true}}};
}
