import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {displayTitle} from '../lib/display-title';
import {buildNetwork} from '../lib/knowledge-network';
import {orbitDocument} from '../lib/orbit-document';

const titles=['Bencho — Interactive React UI Components & Micro-interactions','Motion — Premium Interactive Web Sections','Beautiful UI — Crafted primitives for AI-native interfaces','Motion Prompt | AIに頼むための「名前」のライブラリ','dissolve · Animated components for React Native and React','这是一份没有分隔符但需要保留完整原始名称的知识库资料😀'];

test('display aliases preserve source titles and meaningful hyphens, with no shortening of personal records',()=>{
 assert.equal(displayTitle(titles[0]),'Bencho');
 assert.equal(displayTitle(titles[3]),'Motion Prompt');assert.equal(displayTitle('Motion Prompt|AIに頼む名前のライブラリ'),'Motion Prompt');
 assert.equal(displayTitle('GPT-5 2026-11-24'),'GPT-5 2026-11-24');
 assert.equal(displayTitle('第一章 — 原件保护','note'),'第一章 — 原件保护');
 const graph=buildNetwork(titles.map((title,i)=>({id:String(i),title,original_url:'https://example.org/'+i,final_url:null,platform:'web',summary:'',ai_summary:null,tags:['设计'],status:'indexed'})),[]);
 assert.equal(graph.nodes.find(n=>n.id==='0')?.title,titles[0]);
 assert.equal(graph.nodes.find(n=>n.id==='0')?.display_title,'Bencho');
});

test('actual canvas labels fit mobile edges, stay anchored below nodes and keep full-title search and details',()=>{
 for(const width of [320,390,768,1440]){
  const stroked:string[]=[];
  const height=700,drawn:{text:string;x:number;y:number;width:number;height:number}[]=[],errors:string[]=[];
  const context:Record<string,any>={font:'12px sans-serif',createRadialGradient:()=>({addColorStop(){}}),createPattern:()=>null};
  const measure=(text:string)=>Array.from(text).reduce((n,ch)=>n+(/[^\x00-\xff]/u.test(ch)?1:.58),0)*(parseFloat(context.font.match(/([\d.]+)px/)?.[1]||'12'));
  context.strokeText=(text:string)=>stroked.push(text);
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
   for(const node of graph.nodes){const wrapped=w.eval('graphLabel(byId.get('+JSON.stringify(node.id)+'),142)') as {lines:string[];text:string};assert.equal(wrapped.lines.join('').replace(/\s/gu,''),node.display_title.replace(/\s/gu,''),'wrapping must retain every title character');assert(!wrapped.text.endsWith('…'));}
   w.eval("updateNodeTooltip(byId.get('0'),{x:100,y:100})");assert.equal(w.document.querySelector('#node-tooltip strong')!.textContent,titles[0]);

   w.eval('frame(performance.now())');
   const labels=drawn.filter(d=>d.text.length>1);
   assert.ok(labels.length>0,'titles remain discoverable');
   assert.deepEqual(stroked,[],'reference typography uses clean fill text without a heavy outline');
   for(const label of labels){assert.ok(label.width<=204.01);assert.ok(label.x-label.width/2>=11.9);assert.ok(label.x+label.width/2<=width-11.9);assert.ok(!label.text.includes('\ufffd'));}
   const anchors=w.eval('labelHitBoxes.map(box=>({top:box.top,nodeY:screen(box.node).y}))') as {top:number;nodeY:number}[];
   for(const anchor of anchors)assert(anchor.top>anchor.nodeY,'labels always stay below their node');
   const sample=()=>w.eval("labelHitBoxes.map(box=>({id:box.node.id,offset:box.top-screen(box.node).y,height:box.bottom-box.top}))") as {id:string;offset:number;height:number}[];
   // Crowding and hover used to flip labels above nodes or change their wrapping.
   w.eval("nodes.forEach((n,i)=>{n.x=(i%2)*3;n.y=Math.floor(i/2)*3;});drawGraphLabels(false,null,null)");
   const initial=sample();assert.equal(initial.length,nodesCount());
   function nodesCount(){return w.eval('nodes.length');}
   for(let frame=0;frame<40;frame++){
    w.eval("nodes.forEach((n,i)=>{n.x+=Math.sin(i+"+frame+")*.5;n.y+=Math.cos(i+"+frame+")*.5;});drawGraphLabels("+(frame%2===0)+",byId.get('0'),null)");
    const current=sample();assert.equal(current.length,initial.length,'neighbor motion never hides a title');
    for(const anchor of current){const previous=initial.find(x=>x.id===anchor.id)!;assert(Math.abs(anchor.offset-previous.offset)<1e-8);assert.equal(anchor.height,previous.height,'hover must not rewrap the title');}
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
  win.dispatchEvent(new win.MessageEvent('message',{source:win as unknown as Window,data:{type:'cheesecool:state',mode:'light',paused:false,query:'',focus:'',saved:null}}));
  assert.deepEqual(errors,[]);assert.equal(win.document.documentElement.dataset.theme,'light');
  assert(messages.some((m:any)=>m.type==='cheesecool:painted'),'parent must reveal the graph before RAF is available');
 }finally{dom.window.close();}
});

test('theme changes paint synchronously even with RAF suspended and retain the camera on rapid toggles',()=>{
 let backgrounds=0,arcs=0;const errors:string[]=[];
 const context=new Proxy({createRadialGradient:()=>({addColorStop(){}}),createPattern:()=>null,measureText:()=>({width:20}),drawImage(){backgrounds++;},arc(){arcs++;}}, {get:(value,key)=>key in value?value[key as keyof typeof value]:()=>{}});
 const graph=buildNetwork([{id:'saved',title:'Saved knowledge',original_url:'https://example.org/saved',final_url:null,platform:'web',summary:'Saved source',ai_summary:null,tags:['设计'],status:'indexed'}],[]);
 const console=new VirtualConsole();console.on('jsdomError',e=>{if(!('type' in e)||e.type!=='css-parsing')errors.push(e.message);});
 const dom=new JSDOM(orbitDocument.replace('__PAYLOAD__','window.__cheesecool='+JSON.stringify(graph)+';'),{runScripts:'dangerously',virtualConsole:console,beforeParse(win){
  win.matchMedia=()=>({matches:false}) as MediaQueryList;win.requestAnimationFrame=()=>0;win.cancelAnimationFrame=()=>{};
  win.HTMLCanvasElement.prototype.getContext=(()=>context) as any;
  Object.defineProperty(win.HTMLCanvasElement.prototype,'clientWidth',{get:()=>1440});Object.defineProperty(win.HTMLCanvasElement.prototype,'clientHeight',{get:()=>900});
 }});
 try{
  const win=dom.window;win.eval('manualCamera=true;scale=.65;ox=72;oy=-31');const camera=win.eval('[scale,ox,oy].join()');
  for(const mode of ['light','dark','light','dark','light']){
   const before=backgrounds,oldArcs=arcs;
   win.dispatchEvent(new win.MessageEvent('message',{source:win as unknown as Window,data:{type:'cheesecool:state',mode,paused:true,query:'',focus:'',saved:null}}));
   assert.equal(win.document.documentElement.dataset.theme,mode);assert(backgrounds>before,'background repaints without waiting for RAF');assert(arcs>oldArcs,'nodes repaint in the same task');assert.equal(win.eval('[scale,ox,oy].join()'),camera);
  }
  win.dispatchEvent(new win.MessageEvent('message',{source:win as unknown as Window,data:{type:'cheesecool:state',mode:'light',paused:false,query:'',focus:'',saved:{id:'saved',event:1}}}));
  assert.equal(win.eval('selected'),null);assert.equal(win.document.querySelector('#panel')!.hasAttribute('hidden'),true);assert.equal(win.eval("arrivalProgress('saved',180,620)"),0);
  win.eval('cameraTween=null');const originalTarget=win.eval("[byId.get('saved').tx,byId.get('saved').ty].join()");
  const updated=buildNetwork([{id:'saved',title:'Saved knowledge',original_url:'https://example.org/saved',final_url:null,platform:'web',summary:'Saved source',ai_summary:null,tags:['设计'],status:'indexed'},{id:'related',title:'Related knowledge',original_url:'https://example.org/related',final_url:null,platform:'web',summary:'Related source',ai_summary:null,tags:['设计'],status:'indexed'}],[]);
  const sendGraph=()=>win.dispatchEvent(new win.MessageEvent('message',{source:win as unknown as Window,data:{type:'cheesecool:graph',graph:updated}}));sendGraph();
  assert.equal(win.eval('links.length'),1);assert.equal(win.eval('edgeBirths.size'),1,'late real relation must grow after save');
  assert.equal(win.eval('[scale,ox,oy].join()'),camera);assert.equal(win.eval("[byId.get('saved').tx,byId.get('saved').ty].join()"),originalTarget);
  const started=win.eval("[...edgeBirths.values()][0].started");sendGraph();assert.equal(win.eval("[...edgeBirths.values()][0].started"),started,'unchanged refresh must not restart growth');
  assert.equal(win.eval('nodes.length'),2);
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('a temporarily zero-size or interrupted canvas recovers without losing knowledge or leaving the camera invalid',()=>{
 let width=0,height=0,failNextImage=false,images=0;const messages:any[]=[],errors:string[]=[];
 const context=new Proxy({createRadialGradient:()=>({addColorStop(){}}),createPattern:()=>null,measureText:()=>({width:30}),drawImage(){if(failNextImage){failNextImage=false;throw new Error('Discarded backing store');}images++;}}, {get:(value,key)=>key in value?value[key as keyof typeof value]:()=>{}});
 const graph=buildNetwork([{id:'saved',title:'Saved knowledge',original_url:'https://example.org/saved',final_url:null,platform:'web',summary:'Saved source',ai_summary:null,tags:['设计'],status:'indexed'}],[]);
 const console=new VirtualConsole();console.on('jsdomError',e=>{if(!('type' in e)||e.type!=='css-parsing')errors.push(e.message);});
 const dom=new JSDOM(orbitDocument.replace('__PAYLOAD__','window.__cheesecool='+JSON.stringify(graph)+';'),{runScripts:'dangerously',virtualConsole:console,beforeParse(win){
  win.matchMedia=()=>({matches:false}) as MediaQueryList;win.requestAnimationFrame=()=>0;win.cancelAnimationFrame=()=>{};win.postMessage=(message:unknown)=>messages.push(message);
  win.HTMLCanvasElement.prototype.getContext=(()=>context) as any;
  Object.defineProperty(win.HTMLCanvasElement.prototype,'clientWidth',{get:()=>width});Object.defineProperty(win.HTMLCanvasElement.prototype,'clientHeight',{get:()=>height});
 }});
 try{
  const win=dom.window;assert.equal(win.eval('safePaint(performance.now())'),false);assert.equal(win.eval('paintFailures'),0);
  width=1440;height=900;win.dispatchEvent(new win.Event('resize'));assert.equal(win.eval('safePaint(performance.now())'),true);assert(images>0);
  failNextImage=true;assert.equal(win.eval('safePaint(performance.now())'),false);assert.equal(win.eval('safePaint(performance.now())'),true);assert.equal(win.eval('paintFailures'),0);
  win.eval("byId.get('saved').x=NaN;byId.get('saved').tx=NaN;scale=NaN;ox=Infinity");assert.equal(win.eval('safePaint(performance.now())'),true);assert.equal(win.eval('[scale,ox,oy,...nodes.flatMap(n=>[n.x,n.y,n.tx,n.ty])].every(Number.isFinite)'),true);
  const camera=win.eval('[scale,ox,oy].join()');win.document.querySelector('canvas')!.dispatchEvent(new win.Event('contextrestored'));assert.equal(win.eval('[scale,ox,oy].join()'),camera);
  win.dispatchEvent(new win.MessageEvent('message',{source:win as unknown as Window,data:{type:'cheesecool:render-check'}}));assert(messages.some(m=>m.type==='cheesecool:render-health'&&m.ok));assert.equal(win.eval('nodes.length'),1);assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('compact view disclosure preserves zoom and motion controls with outside and keyboard dismissal',()=>{
 for(const width of [320,1440]){
  const errors:string[]=[];
  const context=new Proxy({createRadialGradient:()=>({addColorStop(){}}),measureText:()=>({width:30})},{get:(value,key)=>key in value?value[key as keyof typeof value]:()=>{}});
  const graph=buildNetwork([{id:'saved',title:'Saved knowledge',original_url:'https://example.org/saved',final_url:null,platform:'web',summary:'Saved source',ai_summary:null,tags:['设计'],status:'indexed'}],[]);
  const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!('type' in e)||e.type!=='css-parsing')errors.push(e.message);});
  const dom=new JSDOM(orbitDocument.replace('__PAYLOAD__','window.__cheesecool='+JSON.stringify(graph)+';'),{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(win){
   win.matchMedia=()=>({matches:false}) as MediaQueryList;win.requestAnimationFrame=()=>0;win.cancelAnimationFrame=()=>{};
   win.HTMLCanvasElement.prototype.getContext=(()=>context) as any;
   Object.defineProperty(win.HTMLCanvasElement.prototype,'clientWidth',{get:()=>width});Object.defineProperty(win.HTMLCanvasElement.prototype,'clientHeight',{get:()=>780});
  }});
  try{
   const w=dom.window,toggle=w.document.querySelector<HTMLButtonElement>('#view-toggle')!,actions=w.document.querySelector<HTMLElement>('#view-actions')!;
   const button=(id:string)=>w.document.getElementById(id) as HTMLButtonElement;
   assert(actions.hidden);assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(w.getComputedStyle(toggle).width,'44px');assert.equal(w.getComputedStyle(actions).display,'none');
   toggle.click();assert(!actions.hidden);assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.equal(w.getComputedStyle(actions).display,'grid');
   const oldScale=Number(w.eval('scale'));button('plus').click();assert(Number(w.eval('scale'))>oldScale);button('minus').click();assert(Math.abs(Number(w.eval('scale'))-oldScale)<1e-8);assert(!actions.hidden);
   const wasPaused=w.eval('paused');button('motion').click();assert.notEqual(w.eval('paused'),wasPaused);assert(!actions.hidden);
   w.document.body.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert(actions.hidden);
   toggle.click();button('motion').focus();w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(actions.hidden);assert.equal(w.document.activeElement,toggle);
   toggle.click();button('reset').click();assert(actions.hidden);assert.equal(w.document.activeElement,toggle);
   toggle.click();button('wander').click();assert(actions.hidden);assert(w.eval('tour')!==null);w.eval('stopTour()');
   toggle.click();w.eval("show(byId.get('saved'))");assert(actions.hidden,'opening details must not leave a stale menu open');
   const baseline=JSON.parse(String(w.eval('JSON.stringify(nodes.map(n=>[n.id,n.tx,n.ty]))')));
   w.eval('nodes.forEach(n=>{n.x=n.tx+=500;n.y=n.ty-=300});ox=900;oy=-600;scale=2;manualCamera=true');
   toggle.click();button('restore-layout').click();assert(actions.hidden);assert.equal(w.document.activeElement,toggle);
   assert.deepEqual(JSON.parse(String(w.eval('JSON.stringify(nodes.map(n=>[n.id,n.tx,n.ty]))'))),baseline,'restores node anchors, not just the viewport');
   assert.equal(w.eval('paused'),!wasPaused,'preserves the motion setting');assert.equal(w.eval('selected'),null);assert.equal(w.eval('tour'),null);assert(w.eval('cameraTween!==null'),'recenters the restored layout');
   const updated=JSON.parse(JSON.stringify(graph));updated.nodes[0].orbitX=123;updated.nodes[0].orbitY=-87;
   w.dispatchEvent(new w.MessageEvent('message',{source:w as unknown as Window,data:{type:'cheesecool:graph',graph:updated}}));
   w.eval('nodes[0].tx=999;nodes[0].ty=999');toggle.click();button('restore-layout').click();
   assert.deepEqual(JSON.parse(String(w.eval('JSON.stringify([nodes[0].tx,nodes[0].ty])'))),[123,-87],'uses the latest source layout after graph updates');

   assert.deepEqual(errors,[]);
  }finally{dom.window.close();}
 }
});

test('topic constellation previews are reversible and never change the selected topic or camera',()=>{
 const errors:string[]=[];
 const context=new Proxy({createRadialGradient:()=>({addColorStop(){}}),measureText:()=>({width:30})},{get:(value,key)=>key in value?value[key as keyof typeof value]:()=>{}});
 const graph=buildNetwork(['设计','设计','知识','知识'].map((tag,i)=>({id:'n'+i,title:'材料 '+i,original_url:'https://example.org/'+i,final_url:null,platform:'web' as const,summary:'原文',ai_summary:null,tags:[tag],status:'indexed'})),[]);
 const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!('type' in e)||e.type!=='css-parsing')errors.push(e.message);});
 const dom=new JSDOM(orbitDocument.replace('__PAYLOAD__','window.__cheesecool='+JSON.stringify(graph)+';'),{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(win){
  win.matchMedia=()=>({matches:false}) as MediaQueryList;win.requestAnimationFrame=()=>0;win.cancelAnimationFrame=()=>{};
  win.HTMLCanvasElement.prototype.getContext=(()=>context) as any;
  Object.defineProperty(win.HTMLCanvasElement.prototype,'clientWidth',{get:()=>1440});Object.defineProperty(win.HTMLCanvasElement.prototype,'clientHeight',{get:()=>900});
 }});
 try{
  const w=dom.window,nav=w.document.querySelector('#filters')!,buttons=[...nav.querySelectorAll<HTMLButtonElement>('button[data-g]')];
  assert.equal(nav.querySelector('.theme-label')!.textContent,'芝士星群');assert.equal(buttons.length,3);assert(buttons.every(b=>b.querySelector('svg[aria-hidden=true]')));assert.deepEqual(buttons.map(b=>b.querySelector('small')!.textContent),['4','2','2']);
  w.eval('manualCamera=true;cameraTween=null;scale=.65;ox=72;oy=-31');const camera=w.eval('[scale,ox,oy].join()');
  buttons[1].querySelector('svg > *')!.dispatchEvent(new w.Event('pointerover',{bubbles:true}));
  assert.equal(w.eval('previewTopic'),0);assert.equal(w.eval('filter'),-1);assert.equal(w.eval('[scale,ox,oy].join()'),camera);assert.equal(buttons[0].getAttribute('aria-pressed'),'true');assert.equal(buttons[1].dataset.previewed,'true');assert(w.eval('nodes.filter(inHighlightedTopic).every(n=>n.g===0)'));
  nav.dispatchEvent(new w.Event('pointerleave'));assert.equal(w.eval('previewTopic'),null);assert.equal(w.eval('nodes.filter(inHighlightedTopic).length'),4);
  buttons[1].click();assert.equal(w.eval('filter'),0);assert.equal(w.eval('previewTopic'),null);assert.equal(buttons[1].getAttribute('aria-pressed'),'true');assert(w.eval('cameraTween!==null'));
  w.eval('cameraTween=null');buttons[2].dispatchEvent(new w.Event('pointerover',{bubbles:true}));assert.equal(w.eval('previewTopic'),1);assert.equal(w.eval('filter'),0);nav.dispatchEvent(new w.Event('pointerleave'));assert(w.eval('nodes.filter(inHighlightedTopic).every(n=>n.g===0)'));
  const touch=new w.Event('pointerover',{bubbles:true});Object.defineProperty(touch,'pointerType',{value:'touch'});buttons[2].dispatchEvent(touch);assert.equal(w.eval('previewTopic'),null);
  buttons[2].focus();assert.equal(w.eval('previewTopic'),1);w.document.getElementById('view-toggle')!.focus();assert.equal(w.eval('previewTopic'),null);
  buttons[0].click();assert.equal(w.eval('filter'),-1);assert.equal(w.eval('nodes.filter(inTopic).length'),4);
  w.dispatchEvent(new w.MessageEvent('message',{source:w as unknown as Window,data:{type:'cheesecool:state',mode:'light',paused:true,query:'',focus:'',saved:null}}));assert.equal(buttons[1].style.getPropertyValue('--topic-color'),w.eval('groups[0].color'));
  const toggle=w.document.querySelector<HTMLButtonElement>('#topics-toggle')!,list=w.document.querySelector<HTMLElement>('#topic-list')!;
  buttons[1].click();w.eval('cameraTween=null');const beforeCollapse=w.eval('[filter,scale,ox,oy,paused].join()');
  toggle.click();assert(list.hidden);assert.equal(toggle.getAttribute('aria-expanded'),'false');assert(toggle.getAttribute('aria-label')!.includes(String(w.eval('groups[filter].name'))));assert.equal(w.getComputedStyle(toggle).width,'44px');assert.equal(w.getComputedStyle(toggle).height,'44px');assert.equal(w.getComputedStyle(toggle.querySelector('.constellation-toggle')!).display,'block');assert.equal(w.getComputedStyle(toggle.querySelector('.theme-label')!).display,'none');assert.equal(w.eval('previewTopic'),null);assert.equal(w.eval('[filter,scale,ox,oy,paused].join()'),beforeCollapse);
  w.eval('renderFilters()');assert(w.document.querySelector<HTMLElement>('#topic-list')!.hidden,'graph updates preserve the disclosure state');
  w.document.querySelector<HTMLButtonElement>('#topics-toggle')!.click();assert(!w.document.querySelector<HTMLElement>('#topic-list')!.hidden);assert.equal(w.eval('[filter,scale,ox,oy,paused].join()'),beforeCollapse);
  const names=['全部芝士','交互动画','社交媒体','公司披露','股市','黄金','界面组件','前端开发','视频平台','Pablo Stanley','未分类'];
  const icons=names.map(name=>w.eval('topicGlyph('+JSON.stringify(name)+')'));
  assert.equal(new Set(icons).size,names.length,'each common topic has a distinct semantic icon');
  assert.equal(w.eval("topicGlyph('自定义主题')"),w.eval("topicGlyph('自定义主题')"),'fallback icons are stable');
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('site logos paint on ordinary nodes while paused and failed images retain the cheese fallback',()=>{
 const images:any[]=[],draws:any[]=[];
 class IconImage{src='';complete=false;naturalWidth=0;onload:(()=>void)|null=null;constructor(){images.push(this);}}
 const context=new Proxy({createRadialGradient:()=>({addColorStop(){}}),measureText:()=>({width:30}),drawImage:(value:unknown)=>draws.push(value)},{get:(value,key)=>key in value?value[key as keyof typeof value]:()=>{}});
 const graph=buildNetwork([0,1].map(i=>({id:'logo'+i,title:'Source '+i,original_url:'https://example.org/'+i,final_url:null,platform:'web' as const,summary:'Source',ai_summary:null,tags:['设计'],status:'indexed'})),[]);
 const dom=new JSDOM(orbitDocument.replace('__PAYLOAD__','window.__cheesecool='+JSON.stringify(graph)+';'),{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(win){
  win.Image=IconImage as any;win.matchMedia=()=>({matches:false}) as MediaQueryList;win.requestAnimationFrame=()=>0;win.cancelAnimationFrame=()=>{};
  win.HTMLCanvasElement.prototype.getContext=(()=>context) as any;
  Object.defineProperty(win.HTMLCanvasElement.prototype,'clientWidth',{get:()=>1440});Object.defineProperty(win.HTMLCanvasElement.prototype,'clientHeight',{get:()=>900});
 }});
 try{
  const w=dom.window;w.eval('paused=true;scale=1');
  const fallback=images[0];fallback.complete=true;fallback.naturalWidth=96;fallback.onload();
  const ordinary=String(w.eval('nodes.find(n=>!n.hub).id'));
  const send=(url:string)=>w.dispatchEvent(new w.MessageEvent('message',{source:w as unknown as Window,data:{type:'cheesecool:icons',icons:{[ordinary]:url}}}));
  send('data:image/png;base64,aGVsbG8=');const logo=images.at(-1);draws.length=0;logo.complete=true;logo.naturalWidth=64;logo.onload();
  assert(draws.includes(logo),'image arrival repaints a paused canvas, including ordinary nodes');assert(draws.includes(fallback),'nodes without logos retain the branded fallback');
  draws.length=0;logo.naturalWidth=0;w.eval('safePaint(performance.now())');assert(!draws.includes(logo));assert(draws.includes(fallback),'broken images never replace the cheese with a blank node');
  const count=images.length;send('https://untrusted.invalid/icon.png');assert.equal(images.length,count,'iframe accepts only validated raster data');
 }finally{dom.window.close();}
});
