import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {displayTitle} from '../lib/display-title';
import {buildNetwork} from '../lib/knowledge-network';
import {orbitDocument} from '../lib/orbit-document';

const titles=['Bencho — Interactive React UI Components & Micro-interactions','Motion — Premium Interactive Web Sections','Beautiful UI — Crafted primitives for AI-native interfaces','Motion Prompt | AIに頼むための「名前」のライブラリ','dissolve · Animated components for React Native and React','这是一份没有分隔符但需要保留完整原始名称的知识库资料😀'];

test('display aliases preserve source titles and meaningful hyphens, with no shortening of personal records',()=>{
 assert.equal(displayTitle(titles[0]),'Bencho');
 assert.equal(displayTitle(titles[3]),'Motion Prompt');
 assert.equal(displayTitle('GPT-5 2026-11-24'),'GPT-5 2026-11-24');
 assert.equal(displayTitle('第一章 — 原件保护','note'),'第一章 — 原件保护');
 const graph=buildNetwork(titles.map((title,i)=>({id:String(i),title,original_url:'https://example.org/'+i,final_url:null,platform:'web',summary:'',ai_summary:null,tags:['设计'],status:'indexed'})),[]);
 assert.equal(graph.nodes.find(n=>n.id==='0')?.title,titles[0]);
 assert.equal(graph.nodes.find(n=>n.id==='0')?.display_title,'Bencho');
});

test('actual canvas labels fit mobile edges, avoid one another and keep full-title search and details',()=>{
 for(const width of [320,390,768,1440]){
  const height=700,drawn:{text:string;x:number;y:number;width:number;height:number}[]=[],errors:string[]=[];
  const context:Record<string,any>={font:'12px sans-serif',createRadialGradient:()=>({addColorStop(){}}),createPattern:()=>null};
  const measure=(text:string)=>Array.from(text).reduce((n,ch)=>n+(/[^\x00-\xff]/u.test(ch)?1:.58),0)*(parseFloat(context.font.match(/([\d.]+)px/)?.[1]||'12'));
  context.measureText=(text:string)=>({width:measure(text)});context.fillText=(text:string,x:number,y:number)=>drawn.push({text,x,y,width:measure(text),height:parseFloat(context.font.match(/([\d.]+)px/)?.[1]||'12')});
  const ctx=new Proxy(context,{get:(object,key)=>key in object?object[key as string]:()=>{}});
  const graph=buildNetwork(titles.map((title,i)=>({id:String(i),title,original_url:'https://example.org/'+i,final_url:null,platform:'web',summary:'Original abstract',ai_summary:null,tags:['设计'],status:'indexed'})),[]);
  const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!('type' in e)||e.type!=='css-parsing')errors.push(e.message);});
  const dom=new JSDOM(orbitDocument.replace('__PAYLOAD__','window.__cheesecool='+JSON.stringify(graph)+';'),{runScripts:'dangerously',virtualConsole:vc,beforeParse(win){
   win.matchMedia=()=>({matches:true}) as MediaQueryList;win.requestAnimationFrame=()=>0;win.cancelAnimationFrame=()=>{};
   win.HTMLCanvasElement.prototype.getContext=(()=>ctx) as any;
   Object.defineProperty(win.HTMLCanvasElement.prototype,'clientWidth',{get:()=>width});Object.defineProperty(win.HTMLCanvasElement.prototype,'clientHeight',{get:()=>height});
  }});
  try{
   assert.deepEqual(errors,[]);
   const w=dom.window;
   w.eval('frame(performance.now())');
   const labels=drawn.filter(d=>d.text.length>1);
   assert.ok(labels.length>0,'titles remain discoverable');
   for(const label of labels){assert.ok(label.width<=204.01);assert.ok(label.x-label.width/2>=11.9);assert.ok(label.x+label.width/2<=width-11.9);assert.ok(!label.text.includes('\ufffd'));}
   for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
    const a=labels[i],b=labels[j];assert.ok(a.x+a.width/2<=b.x-b.width/2||b.x+b.width/2<=a.x-a.width/2||a.y<=b.y-b.height||b.y<=a.y-a.height,'labels must not intersect');
   }
   drawn.length=0;w.eval("hover=byId.get('0');frame(performance.now())");assert.ok(drawn.some(d=>d.text==='Bencho'),'focused title has priority');
   w.eval("query='micro-interactions';updateCount()");assert.equal(w.document.querySelector('#count')!.textContent,'1 个节点','search still sees removed tagline');
   w.eval("query='';show(byId.get('0'))");assert.ok(w.document.querySelector('#panel h2')!.getAttribute('title')===titles[0]);
   w.eval("detailTab='relations';renderPanel()");
   const evidenceButton=w.document.querySelector<HTMLButtonElement>('[data-evidence]');assert.ok(evidenceButton);evidenceButton.click();
   const token=w.eval('relationView.token');assert.ok(w.document.querySelector('.detail-viewport')!.textContent!.includes('正在对照'));
   const data={basis:{reason:'共同主题：界面组件'},sources:[{id:'0',title:titles[0],archive_url:'/document/0'}],analysis:{kind:'related',reason:'仅根据片段的 AI 建议。'.repeat(150),evidence:[{source_id:'0',quote:'逐字原文证据，保留来源。'}]}};
   w.dispatchEvent(new w.MessageEvent('message',{source:w as unknown as Window,data:{type:'cheesecool:relation-result',token:'stale',data}}));assert.ok(w.document.querySelector('.detail-viewport')!.textContent!.includes('正在对照'));
   w.dispatchEvent(new w.MessageEvent('message',{source:w as unknown as Window,data:{type:'cheesecool:relation-result',token,data}}));assert.ok(w.document.querySelector('.detail-viewport')!.textContent!.includes('共同主题'));
   assert.equal(w.document.querySelector('[data-tab="relations"]')!.getAttribute('aria-pressed'),'true');
   assert.equal(w.getComputedStyle(w.document.querySelector('.detail-viewport')!).overflow,'clip');
   assert.ok(w.document.querySelector('[data-page="1"]')!.hasAttribute('hidden')===false,'long explanations paginate');
   (w.document.querySelector('[data-relation-back]') as HTMLButtonElement).click();assert.ok(w.document.querySelector('[data-evidence]'));
   assert.deepEqual(errors,[]);
  }finally{dom.window.close();}
 }
});

test('initial theme handshake reveals the graph even while a desktop browser suspends hidden-frame animation',()=>{
 const messages:unknown[]=[],errors:string[]=[];
 const context=new Proxy({createRadialGradient:()=>({addColorStop(){}}),measureText:()=>({width:20})},{get:(value,key)=>key in value?value[key as keyof typeof value]:()=>{}});
 const graph=buildNetwork([{id:'saved',title:'Saved knowledge',original_url:'https://example.org/saved',final_url:null,platform:'web',summary:'Saved source',ai_summary:null,tags:['设计'],status:'indexed'}],[]);
 const console=new VirtualConsole();console.on('jsdomError',e=>{if(!('type' in e)||e.type!=='css-parsing')errors.push(e.message);});
 const dom=new JSDOM(orbitDocument.replace('__PAYLOAD__','window.__cheesecool='+JSON.stringify(graph)+';'),{runScripts:'dangerously',virtualConsole:console,beforeParse(win){
  win.matchMedia=()=>({matches:true}) as MediaQueryList;
  // Chrome may suspend RAF until the parent removes visibility:hidden.
  win.requestAnimationFrame=()=>0;win.cancelAnimationFrame=()=>{};
  win.postMessage=(message:unknown)=>messages.push(message);
  win.HTMLCanvasElement.prototype.getContext=(()=>context) as any;
  Object.defineProperty(win.HTMLCanvasElement.prototype,'clientWidth',{get:()=>1440});Object.defineProperty(win.HTMLCanvasElement.prototype,'clientHeight',{get:()=>900});
 }});
 try{
  const win=dom.window;
  win.dispatchEvent(new win.MessageEvent('message',{source:win,data:{type:'cheesecool:state',mode:'light',paused:false,query:'',focus:'',saved:null}}));
  assert.deepEqual(errors,[]);assert.equal(win.document.documentElement.dataset.theme,'light');
  assert(messages.some((m:any)=>m.type==='cheesecool:painted'),'parent must reveal the graph before RAF is available');
 }finally{dom.window.close();}
});
