import {inflateRawSync} from 'node:zlib';
export function checkDocxArchive(bytes:Buffer){
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw new Error('DOCX 文件结构无效');const count=bytes.readUInt16LE(end+10);let at=bytes.readUInt32LE(end+16),total=0;
 if(count>1000)throw new Error('文档包含过多内部文件');
 for(let n=0;n<count;n++){
  if(at+46>bytes.length||bytes.readUInt32LE(at)!==0x02014b50)throw new Error('DOCX 目录无效');
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),compressed=bytes.readUInt32LE(at+20),expanded=bytes.readUInt32LE(at+24),offset=bytes.readUInt32LE(at+42);
  if(flags&1||expanded>20000000||total+expanded>20000000||offset+30>bytes.length||bytes.readUInt32LE(offset)!==0x04034b50)throw new Error('文档加密或解压体积过大');
  const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28);if(start+compressed>bytes.length)throw new Error('DOCX 数据无效');
  const input=bytes.subarray(start,start+compressed);let output:Buffer;if(method===0)output=input;else if(method===8)output=inflateRawSync(input,{maxOutputLength:20000000-total});else throw new Error('不支持此 DOCX 压缩方式');
  if(output.length!==expanded)throw new Error('DOCX 解压长度不一致');total+=output.length;
  at+=46+bytes.readUInt16LE(at+28)+bytes.readUInt16LE(at+30)+bytes.readUInt16LE(at+32);
 }
}
export async function parseDocumentFile(bytes:Buffer,name:string){
 const extension=name.split('.').pop()?.toLowerCase();
 if(['txt','md','csv','json'].includes(extension||'')){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return {text,mediaType:extension==='json'?'application/json':'text/plain',pages:null};
 }
 if(extension==='pdf'){
  if(bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('PDF 文件头无效');
  const {getDocumentProxy,extractText}=await import('unpdf');const pdf=await getDocumentProxy(new Uint8Array(bytes),{maxImageSize:16777216});
  try{if(pdf.numPages>200)throw new Error('单个 PDF 最多 200 页');const {text,totalPages}=await extractText(pdf,{mergePages:true});if(!text.trim())throw new Error('此 PDF 未含可提取文字，需要 OCR 服务');return {text,mediaType:'application/pdf',pages:totalPages};}finally{await pdf.loadingTask.destroy();}
 }
 if(extension==='docx'){
  checkDocxArchive(bytes);const mammoth=await import('mammoth');const {value}=await mammoth.extractRawText({buffer:bytes});if(!value.trim())throw new Error('DOCX 中未找到正文');return {text:value,mediaType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pages:null};
 }
 throw new Error('支持 PDF、DOCX、TXT、Markdown、CSV 和 JSON 文件');
}
