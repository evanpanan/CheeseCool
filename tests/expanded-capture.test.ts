import test from 'node:test';
import assert from 'node:assert/strict';
import {githubSource} from '../lib/github-source';
import {extractHtml} from '../lib/extract';
import {understand} from '../lib/ai';
import {captureIsPartial} from '../lib/capture-quality';

const body='结构化原文中的关键事实与证据应当被完整保留。'.repeat(20);
const html=(data:unknown,content='')=>`<html><head><title>文章标题</title><script type="application/ld+json">${JSON.stringify(data)}</script></head><body>${content}</body></html>`;
test('public structured article bodies survive JS-only shells without executing scripts or mixing other articles',()=>{
 const url=new URL('https://example.org/article?utm_source=test');
 const data={'@graph':[{'@type':'NewsArticle',url:'https://example.org/other',articleBody:'不属于当前页面的其他文章内容'.repeat(80)},{'@type':['Article'],url:'https://example.org/article',headline:'文章标题',articleBody:body}]};
 const result=extractHtml(html(data,'<script>throw new Error("must not run")</script><div id="app"></div>'),url);
 assert.equal(result.capture,'structured_article');assert.equal(result.content,body);assert(!result.content.includes('其他文章'));
 const queryMismatch=extractHtml(html({'@type':'Article',url:'https://example.org/article?id=99',articleBody:body}),url);assert(!queryMismatch.content.includes(body));
 const login=extractHtml(html({'@type':'Article',articleBody:body}).replace('<title>文章标题</title>','<title>Sign in</title>'),url);assert.equal(login.capture,'blocked');
 assert.doesNotThrow(()=>extractHtml('<script type="application/ld+json">{bad json</script><main><p>'+body+'</p></main>',url));
});
test('semantic article fallback retains paragraphs and code while excluding navigation and hidden material',()=>{
 const result=extractHtml('<html><title>文档</title><body><main><nav>导航广告</nav><article><h1>安装说明</h1><p>'+body+'</p><pre>npm install\nnode app.js</pre><p hidden>隐藏注入</p></article></main></body></html>',new URL('https://example.org/docs'));
 assert(result.content.includes('npm install'));assert(result.content.includes('node app.js'));assert(!result.content.includes('导航广告'));assert(!result.content.includes('隐藏注入'));
});
function issueReader(fail=false){const calls:string[]=[];return {calls,read:async(url:URL)=>{calls.push(url.href);if(url.pathname.endsWith('/issues/12'))return {text:JSON.stringify({title:'源数据完整性',html_url:'https://github.com/o/r/issues/12',body:'原始问题正文与证据',comments:101,state:'open',created_at:'2026-01-01',user:{login:'author'}})};const page=url.searchParams.get('page');if(fail&&page==='2')throw new Error('rate limit');return {text:JSON.stringify(Array.from({length:page==='1'?100:1},(_,i)=>({body:`第 ${page} 页评论 ${i} 的逐字原文`,created_at:'2026-01-02',user:{login:'reviewer'},html_url:'https://github.com/o/r/issues/12#comment-'+page+'-'+i})))}}};}
test('GitHub issue capture paginates public comments, keeps authors and timestamps, and archives API evidence',async()=>{
 const fixture=issueReader(),result=await githubSource(new URL('https://github.com/o/r/issues/12'),fixture.read);assert(result);assert.equal(result.capture_scope,'issue');assert.equal(result.source_truncated,false);assert(result.content.includes('第 2 页评论 0'));assert(result.content.includes('reviewer'));assert(result.content.includes('2026-01-02'));assert.equal(JSON.parse(result.raw_source).responses.length,3);assert.equal(fixture.calls.length,3);
 const partial=await githubSource(new URL('https://github.com/o/r/issues/12'),issueReader(true).read);assert(partial);assert.equal(partial.capture_scope,'issue_partial');assert(partial.source_truncated);assert(partial.content.includes('原始问题'));assert(!partial.content.includes('第 2 页'));assert(captureIsPartial(partial.capture_scope));
});
test('PR discussion retains review decisions and inline file/line context without claiming a full code snapshot',async()=>{
 const result=await githubSource(new URL('https://github.com/o/r/pull/9'),async url=>({text:JSON.stringify(url.pathname.endsWith('/issues/9')?{title:'修复',body:'原始修复描述',html_url:'https://github.com/o/r/pull/9',comments:0,pull_request:{},user:{login:'dev'}}:url.pathname.endsWith('/reviews')?[{state:'APPROVED',body:'',submitted_at:'2026-01-01',user:{login:'reviewer'}}]:[{body:'这里需要权限检查的原文依据',path:'app/api.ts',line:42,user:{login:'reviewer'}}])}));
 assert(result);assert.equal(result.capture_scope,'pull_request_discussion');assert(result.content.includes('APPROVED'));assert(result.content.includes('app/api.ts · 行 42'));assert(result.content.includes('这里需要权限检查'));
});
test('GitHub file capture binds ref/path and rejects binary, size mismatch and lookalike origins',async()=>{
 const text='# 完整源文件\n\n权限检查在服务端执行。';let endpoint='';
 const read=async(url:URL)=>{endpoint=url.href;return {text:JSON.stringify({type:'file',encoding:'base64',size:Buffer.byteLength(text),content:Buffer.from(text).toString('base64'),sha:'abc123'})};};
 const result=await githubSource(new URL('https://github.com/o/r/blob/release%2Fv1/docs/a%20b.md'),read);assert(result);assert(result.content.includes(text));assert(endpoint.endsWith('/contents/docs/a%20b.md?ref=release%2Fv1'));assert.equal(result.capture_scope,'repository_file');
 assert.equal(await githubSource(new URL('https://github.com.attacker.example/o/r/issues/1'),read),null);
 assert.equal(await githubSource(new URL('https://github.com/o/r/blob/main/file'),async()=>({text:JSON.stringify({type:'file',encoding:'base64',size:2,content:'AAA='})})),null);
});
test('summary input uses Unicode codepoints and validates evidence only against material actually supplied',async()=>{
 const original=globalThis.fetch;let prompt:any;const content='😀'.repeat(4490)+'可验证的原文证据属于当前输入'+'缺失区域的原文证据'.repeat(5);
 try{globalThis.fetch=async(_url,init)=>{prompt=JSON.parse(String(init?.body));return Response.json({choices:[{message:{content:JSON.stringify({summary:'基于已采集内容生成摘要',tags:['知识管理'],evidence:['可验证的原文证据','缺失区域的原文证据']})}}]});};const result=await understand('原件',content,{provider:'deepseek',key:'test',model:'test'},4500,'partial');const input=JSON.parse(prompt.messages[1].content);assert.equal(Array.from(input.content).length,4500);assert(!input.content.includes('缺失区域'));assert.equal(input.scope,'partial');assert.deepEqual(result.evidence,['可验证的原文证据']);globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({summary:'无证据摘要',tags:['知识管理'],evidence:['并不存在的逐字原文证据']})}}]});await assert.rejects(understand('原件',content,{provider:'deepseek',key:'test',model:'test'}),/原文证据/);assert(captureIsPartial('repository_metadata'));assert(!captureIsPartial('structured_article'));assert(captureIsPartial('article',true));
 }finally{globalThis.fetch=original;}
});
