import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import {createServer} from 'node:http';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite/vector';
import {byteRange,assetParts,mediaSourceToken,validMediaSourceToken} from '../lib/original-files';
import {parseMediaDuration,validateTranscript,formatTranscript,inspectMedia,prepareAudioSegment} from '../lib/media-processing';
import {inspectPdfPages,extractPdfPage} from '../lib/pdf-processing';

test('large originals validate exact ordered parts, bounded byte ranges and expiring source tokens',()=>{
 const asset={id:'asset',user_id:'owner',bookmark_id:'b',object_path:'owner/p0',filename:'file',media_type:'application/octet-stream',sha256:'0'.repeat(64),bytes:6,parts:[{ordinal:0,path:'owner/p0',bytes:3,sha256:'1'.repeat(64)},{ordinal:1,path:'owner/p1',bytes:3,sha256:'2'.repeat(64)}]};
 assert.equal(assetParts(asset).length,2);assert.throws(()=>assetParts({...asset,bytes:7}));assert.throws(()=>assetParts({...asset,parts:[{...asset.parts[0],path:'foreign/path'},asset.parts[1]]}));
 assert.deepEqual(byteRange('bytes=2-4',6),{start:2,end:4,partial:true});assert.deepEqual(byteRange('bytes=-2',6),{start:4,end:5,partial:true});assert.throws(()=>byteRange('bytes=6-',6));assert.throws(()=>byteRange('bytes=0-1,3-4',6));
 const now=1700000000000,expires=now/1000+900,token=mediaSourceToken('asset',expires,'test');assert(validMediaSourceToken('asset',expires,token,'test',now));assert(!validMediaSourceToken('other',expires,token,'test',now));assert(!validMediaSourceToken('asset',expires,token,'test',now+901000));
});
test('transcription preserves timestamps and segment-local speaker identity without pretending global identity',()=>{
 assert.equal(parseMediaDuration('Duration: 01:03:04.50'),3784.5);assert.throws(()=>parseMediaDuration('Duration: 05:00:00.00'));
 const parts=validateTranscript({segments:[{speaker:'A',start:1,end:3,text:'Original spoken words'}]},300,5,1,true);assert.equal(parts[0].start,301);assert.equal(parts[0].speaker,'片段2·A');assert.match(formatTranscript(parts,true),/跨段不自动/);assert.throws(()=>validateTranscript({segments:[{speaker:'A',start:1,end:9,text:'invalid'}]},0,5,0,true));
});
test('real FFmpeg prepares seekable audio segments and PDF pages preserve mixed scanned sources',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cc-test-'));let server:ReturnType<typeof createServer>|undefined;
 try{
  const file=join(dir,'original.wav');await promisify(execFile)(ffmpegStatic!,['-f','lavfi','-i','sine=frequency=440:duration=3','-ac','1','-ar','16000','-y',file]);const audio=await readFile(file);
  server=createServer((req,res)=>{const range=byteRange(req.headers.range||null,audio.length);res.writeHead(range.partial?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':range.end-range.start+1,...(range.partial?{'Content-Range':`bytes ${range.start}-${range.end}/${audio.length}`}:{})});res.end(audio.subarray(range.start,range.end+1));});await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;
  const duration=await inspectMedia('http://127.0.0.1:'+port+'/original.wav');assert(Math.abs(duration-3)<.1);const part=await prepareAudioSegment('http://127.0.0.1:'+port+'/original.wav',1,1);assert.equal(part.bytes.subarray(0,4).toString(),'fLaC');assert.equal(part.silent,false);
  const {PDFDocument,StandardFonts}=await import('pdf-lib');const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);doc.addPage().drawText('Protected original text',{font});const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII=','base64');const image=await doc.embedPng(png);doc.addPage().drawImage(image,{x:0,y:0,width:100,height:100});const bytes=Buffer.from(await doc.save());const pages=await inspectPdfPages(bytes);assert.equal(pages.length,2);assert.equal(pages[0].needsOcr,false);assert.equal(pages[1].needsOcr,true);const single=await extractPdfPage(bytes,1);assert.equal((await inspectPdfPages(single)).length,1);
 }finally{if(server)await new Promise<void>(r=>server!.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
test('upload finalization is idempotent, verifies storage pieces and rejects another account',async()=>{
 const db=new PGlite({extensions:{vector}}),owner='00000000-0000-0000-0000-000000000041',other='00000000-0000-0000-0000-000000000042';
 try{
  await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';grant usage on schema auth to authenticated,service_role;create schema storage;create table storage.objects(bucket_id text,name text,metadata jsonb);insert into auth.users values('${owner}'),('${other}');`);
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  const session=await db.query<{id:string}>("insert into public.knowledge_uploads(user_id,filename,media_type,record_kind,bytes) values($1,'test.txt','text/plain','document',6) returning id",[owner]);const id=session.rows[0].id,path=owner+'/uploads/'+id+'/0';await db.query("insert into storage.objects values('knowledge-originals',$1,'{\"size\":6}')",[path]);
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${other}';`);await assert.rejects(db.query('select public.register_knowledge_upload_part($1,0,$2)',[id,'a'.repeat(64)]),/unavailable/);
  await db.exec(`set request.jwt.claim.sub='${owner}';`);await db.query('select public.register_knowledge_upload_part($1,0,$2)',[id,'a'.repeat(64)]);const record=await db.query<{id:string}>('select public.finalize_knowledge_upload($1,$2) id',[id,'b'.repeat(64)]);assert(record.rows[0].id);assert.equal((await db.query<{id:string}>('select public.finalize_knowledge_upload($1,$2) id',[id,'b'.repeat(64)])).rows[0].id,record.rows[0].id);assert.equal((await db.query('select * from public.bookmark_assets')).rows.length,1);
  const captured=await db.query<{id:string}>('select public.capture_browser_document($1,$1,$2,$3,$4) id',['https://example.org/browser','Browser original','完整的浏览器原文，保留登录后可阅读的正文。','<article>完整的浏览器原文，保留登录后可阅读的正文。</article>']);
  await db.query('select public.capture_browser_document($1,$1,$2,$3,$4)',['https://example.org/browser','Browser original','新的浏览器原文版本，旧快照仍需保留。','<article>新的浏览器原文版本，旧快照仍需保留。</article>']);
  assert.equal((await db.query('select * from public.bookmark_sources where bookmark_id=$1',[captured.rows[0].id])).rows.length,2,'browser updates retain old sources');
  await db.exec(`set request.jwt.claim.sub='${other}';`);assert.equal((await db.query('select * from public.knowledge_uploads')).rows.length,0);assert.equal((await db.query('select * from public.bookmark_assets')).rows.length,0);
 }finally{await db.close();}
});
