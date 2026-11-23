import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {parseDocumentFile,checkDocxArchive} from '../lib/document-files';
import {ocrPdf} from '../lib/asset-processing';
function pdfFixture(){
 const contents='BT /F1 12 Tf 72 720 Td (Original knowledge source 123) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${contents.length} >>\nstream\n${contents}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let text='%PDF-1.4\n';const offsets=[0];objects.forEach((body,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${body}\nendobj\n`;});const xref=Buffer.byteLength(text);text+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return Buffer.from(text);
}
test('PDF and DOCX parsing preserves original text without a browser runtime',async()=>{
 const parsed=await parseDocumentFile(pdfFixture(),'source.pdf');assert.equal(parsed.pages,1);assert(parsed.text.includes('Original knowledge source 123'));
 const req=createRequire(require.resolve('mammoth/package.json'));const Zip=req('jszip');const zip=new Zip();
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>完整文档原件</w:t></w:r></w:p></w:body></w:document>');
 const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});const doc=await parseDocumentFile(bytes,'source.docx');assert(doc.text.includes('完整文档原件'));
 const invalid=Buffer.from(bytes);for(let i=0;i<invalid.length-46;i++)if(invalid.readUInt32LE(i)===0x02014b50){invalid.writeUInt32LE(20000001,i+24);break;}assert.throws(()=>checkDocxArchive(invalid),/体积过大/);
});
test('OCR does not pass incomplete model output off as a complete document',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({status:'incomplete',output:[]});
 try{await assert.rejects(ocrPdf(Buffer.from('fixture'),'fixture.pdf','test'),/输出容量/);}finally{globalThis.fetch=original;}
});
