import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,deflateSync,brotliCompressSync} from 'node:zlib';
import {decodePublicBody,PublicReadError} from '../lib/public-http';

test('public HTML and JSON decode gzip, deflate and brotli without losing source text',async()=>{
 const body=Buffer.from('<article>这里是真实正文，保留原始段落。</article>');
 for(const [encoding,bytes]of [[undefined,body],['gzip',gzipSync(body)],['deflate',deflateSync(body)],['br',brotliCompressSync(body)]] as const){assert.equal(await decodePublicBody(bytes,encoding),body.toString());}
});
test('public decompression rejects broken, unknown and oversized responses within the output limit',async()=>{
 for(const [bytes,encoding]of [[Buffer.from('broken'),'gzip'],[Buffer.from('unreadable'),'unknown'],[gzipSync(Buffer.alloc(2000001,97)),'gzip']] as const){await assert.rejects(decodePublicBody(bytes,encoding),error=>error instanceof PublicReadError&&!error.retryable);}
});

test('public reads accept compressed pages and retain retry semantics for upstream status codes',async()=>{
 const dns=require('node:dns/promises'),https=require('node:https'),{Readable}=require('node:stream'),{EventEmitter}=require('node:events');const lookup=dns.lookup,get=https.get;let status=200;
 try{
  dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
  https.get=(_url:URL,_options:unknown,callback:(response:any)=>void)=>{const req=new EventEmitter();req.destroy=(e:Error)=>req.emit('error',e);queueMicrotask(()=>{const res=Readable.from([gzipSync(Buffer.from('<p>压缩的公开正文</p>'))]);res.statusCode=status;res.headers={'content-type':'text/html; charset=utf-8','content-encoding':'gzip'};callback(res);});return req;};
  const {readPublic}=await import('../lib/public-http');assert.equal((await readPublic(new URL('https://example.org/article'))).text,'<p>压缩的公开正文</p>');
  for(const [code,retryable]of [[503,true],[429,true],[403,false],[404,false]] as const){status=code;await assert.rejects(readPublic(new URL('https://example.org/article')),error=>error instanceof PublicReadError&&error.status===code&&error.retryable===retryable);}
 }finally{dns.lookup=lookup;https.get=get;}
});
