import test from 'node:test';import assert from 'node:assert/strict';
import {extractHtml} from '../lib/extract';import {buildNetwork} from '../lib/knowledge-network';import {homepageTitle} from '../lib/display-title';import {understand} from '../lib/ai';
const intro='Example builds artificial intelligence software and cloud infrastructure for enterprises. Its platform helps teams deploy and manage AI agents.';
const news='On April 15 the subsidiary subscribed US dollars to an investment fund and acquired shares. '.repeat(20);
const home='<title>Home Example - Build the future</title><nav>News Login</nav><main><h1>Enterprise AI infrastructure</h1><p>'+intro+'</p><a href="/features"><h2>Deploy AI agents</h2><p>Manage enterprise agents with one platform.</p></a><section class="news"><h2>Latest news</h2><article><a href="/news/report"><h2>April 21 8-K Current report</h2></a><p>'+news+'</p></article></section></main>';

test('home pages capture site identity and capabilities instead of a long news preview',()=>{
 const result=extractHtml(home,new URL('https://example.org/'));assert.equal(result.capture,'homepage');assert(result.content.includes(intro));assert(result.content.includes('Deploy AI agents'));assert(!result.content.includes('Current report'));assert(!result.content.includes('subscribed US dollars'));assert.equal(result.title,'Home Example - Build the future');
 const graph=buildNetwork([{id:'home',title:result.title,original_url:'https://example.org/',final_url:null,platform:'web',summary:result.summary,ai_summary:null,tags:[],status:'extracted',source_hash:'new',attributes:{capture_level:'homepage',node_title:{text:'Example投资基金',source_hash:'new',original_title:result.title}}}],[]);
 assert.equal(graph.nodes[0].display_title,'Example');assert.equal(homepageTitle('Home XMAX - Invest in the Future of Humanity'),'XMAX');
});
test('explicit articles and routed articles remain article captures, including root articles',()=>{
 for(const url of ['https://example.org/news/report','https://example.org/?p=42','https://example.org/']){
  const result=extractHtml('<title>Current report</title><meta property="og:type" content="article"><article><h1>Current report</h1><p>'+news+'</p></article>',new URL(url));assert.equal(result.capture,'article');assert(result.content.includes('subscribed US dollars'));
 }
 assert.match(extractHtml('<title>Single essay</title><article><p>'+intro+'</p></article>',new URL('https://essay.example.org/')).capture,/article$/);
});
test('homepage summarization tells the model to describe the site while retaining evidence checks',async()=>{
 const previous=globalThis.fetch;let request:any;
 try{globalThis.fetch=async(_url,init)=>{request=JSON.parse(String(init?.body));return Response.json({choices:[{message:{content:JSON.stringify({summary:'Example 为企业提供人工智能软件和云基础设施。',tags:['人工智能','云计算','企业服务'],evidence:['artificial intelligence software and cloud infrastructure']})}}]});};
  await understand('Home Example',intro,{provider:'deepseek',key:'test',model:'test'},4500,'complete','homepage');
  assert.equal(JSON.parse(request.messages[1].content).page_kind,'homepage');assert(request.messages[0].content.includes('不得把某条新闻、公告'));
 }finally{globalThis.fetch=previous;}
});
