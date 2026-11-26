'use client';

import { useEffect, useRef, useState } from 'react';
import { orbitDocument } from '@/lib/orbit-document';
import type { buildNetwork } from '@/lib/knowledge-network';

type Props = {
  graph: ReturnType<typeof buildNetwork>;
  night: boolean;
  query: string;
  selected: string;
  saved: { id: string; event: number } | null;
  onSelect: (id: string) => void;
};

export function OrbitCanvas(props: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  const locatedSave = useRef('');
  const icons = useRef<Record<string,string>>({});
  const siteIconRequests=useRef(new Map<string,Promise<string|null>>());
  latest.current = props;
  // Keep one iframe alive while metadata and inferred links arrive.
  const [document] = useState(() => orbitDocument.replace('__PAYLOAD__',
    'window.__cheesecool=' + JSON.stringify(props.graph).replace(/</g, '\\u003c') + ';'));
  const sentGraph = useRef<Props['graph'] | null>(null);
  const currentDocument = useRef(document);
  currentDocument.current = document;
  const [paintedDocument, setPaintedDocument] = useState('');

  const [revision,setRevision]=useState(0);
  const [recovery,setRecovery]=useState<'idle'|'retrying'|'failed'>('idle');
  const lastHealth=useRef(Date.now());
  const lastRestart=useRef(0);
  const attempts=useRef(0);
  function restart(manual=false){
    if(manual)attempts.current=0;
    if(attempts.current>=2){setRecovery('failed');return;}
    attempts.current++;lastRestart.current=Date.now();lastHealth.current=Date.now();
    sentGraph.current=null;setPaintedDocument('');setRecovery('retrying');setRevision(value=>value+1);
  }

  function synchronize() {
    const value = latest.current;
    if(sentGraph.current!==value.graph){
      frame.current?.contentWindow?.postMessage({type:'cheesecool:graph',graph:value.graph},'*');
      sentGraph.current=value.graph;
    }
    // Input focus never pauses the orbit; motion belongs to the canvas controls.
    frame.current?.contentWindow?.postMessage({
      type: 'cheesecool:state', mode: window.document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
      query: value.query, focus: value.selected,
      saved: value.saved && `${value.saved.id}:${value.saved.event}` !== locatedSave.current ? value.saved : null,
    }, '*');
    frame.current?.contentWindow?.postMessage({type:'cheesecool:icons',icons:icons.current},'*');
  }

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'cheesecool:ready') {sentGraph.current=null;synchronize();}
      if(event.data?.type==='cheesecool:render-health'){
        if(event.data.ok===true){lastHealth.current=Date.now();if(Date.now()-lastRestart.current>30000)attempts.current=0;setRecovery('idle');}
        else if(event.data.reason==='paint'&&Date.now()-lastRestart.current>750)restart();
      }
      if (event.data?.type === 'cheesecool:painted') setPaintedDocument(currentDocument.current);
      if (event.data?.type === 'cheesecool:located' && latest.current.saved && event.data.id === latest.current.saved?.id && event.data.event === latest.current.saved.event) {
        locatedSave.current = `${event.data.id}:${event.data.event}`;
      }
      if(event.data?.type==='cheesecool:recapture'){
        const item=latest.current.graph.nodes.find(n=>n.id===event.data.id);
        if(!item||item.record_type&&item.record_type!=='web')return;
        void fetch('/api/bookmarks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,operation:item.source_hash?'recapture':'retry'})})
          .then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||'暂时无法提交，请稍后重试');return result;})
          .then(()=>{frame.current?.contentWindow?.postMessage({type:'cheesecool:recapture-result',id:item.id,ok:true,message:item.source_hash?'已提交，可在内容管理查看新版本':'已提交，正在重新读取'},'*');})
          .catch(error=>{frame.current?.contentWindow?.postMessage({type:'cheesecool:recapture-result',id:item.id,ok:false,message:error.message},'*');});
      }
      if (event.data?.type === 'cheesecool:relation') {
        const {source_id,target_id,token,analyze}=event.data;
        const graph=latest.current.graph;
        if(typeof token!=='string'||token.length>180||typeof source_id!=='string'||typeof target_id!=='string'||!graph.nodes.some(n=>n.id===source_id)||!graph.nodes.some(n=>n.id===target_id)||source_id===target_id)return;
        void fetch('/api/relations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_id,target_id,analyze:analyze===true})})
          .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'关联依据暂时不可用');return data;})
          .then(data=>{if(event.source===frame.current?.contentWindow)frame.current.contentWindow?.postMessage({type:'cheesecool:relation-result',token,data},'*');})
          .catch(error=>{if(event.source===frame.current?.contentWindow)frame.current.contentWindow?.postMessage({type:'cheesecool:relation-result',token,error:error instanceof Error?error.message:'关联依据暂时不可用'},'*');});
      }
      if (event.data?.type === 'cheesecool:interact') window.dispatchEvent(new Event('cheesecool:workspace-outside'));
      if (event.data?.type === 'cheesecool:select' && typeof event.data.id === 'string') latest.current.onSelect(event.data.id);
    }
    window.addEventListener('message', receive);
    // Theme chrome changes immediately; do not wait for a React passive effect.
    window.addEventListener('cheesecool:appearance', synchronize);
    window.addEventListener('storage', synchronize);
    function check(){
      if(window.document.hidden){lastHealth.current=Date.now();return;}
      if(Date.now()-lastHealth.current>5000){restart();return;}
      frame.current?.contentWindow?.postMessage({type:'cheesecool:render-check'},'*');
    }
    const healthTimer=window.setInterval(check,1500);
    function resume(){if(!window.document.hidden){lastHealth.current=Date.now();synchronize();check();}}
    window.addEventListener('pageshow',resume);
    window.document.addEventListener('visibilitychange',resume);
    return () => {
      window.removeEventListener('message', receive);
      window.removeEventListener('cheesecool:appearance', synchronize);
      window.removeEventListener('storage', synchronize);
      window.clearInterval(healthTimer);
      window.removeEventListener('pageshow',resume);
      window.document.removeEventListener('visibilitychange',resume);
    };
  }, []);

  useEffect(()=>{
    let alive=true;
    const sites=new Map<string,string[]>();
    for(const node of props.graph.nodes){
      if(node.record_type&&node.record_type!=='web')continue;
      try{
        const url=new URL(node.final_url||node.original_url);
        if(!['https:','http:'].includes(url.protocol))continue;
        const ids=sites.get(url.origin)||[];ids.push(node.id);sites.set(url.origin,ids);
      }catch{/* non-web records keep the CheeseCool mark */}
    }
    const queue=[...sites];let cursor=0;
    async function loadIcon(id:string){
      try{
        const response=await fetch('/api/site-icon?id='+encodeURIComponent(id),{signal:AbortSignal.timeout(20000)});
        if(!response.ok||response.status===204||response.headers.get('content-type')!=='image/png')return null;
        const blob=await response.blob();if(blob.size>65536)return null;
        return await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('icon'));reader.readAsDataURL(blob);});
      }catch{return null;}
    }
    async function worker(){
      while(alive&&cursor<queue.length){
        const [origin,ids]=queue[cursor++];
        let pending=siteIconRequests.current.get(origin);
        if(!pending){pending=loadIcon(ids[0]);siteIconRequests.current.set(origin,pending);}
        const value=await pending;if(!alive)return;if(!value)continue;
        const updates:Record<string,string>={};
        for(const id of ids){icons.current[id]=value;updates[id]=value;}
        frame.current?.contentWindow?.postMessage({type:'cheesecool:icons',icons:updates},'*');
      }
    }
    // Source identity never blocks the canvas, and repeated domains share a request.
    for(let i=0;i<Math.min(4,queue.length);i++)void worker();
    return()=>{alive=false;};
  },[props.graph]);

  useEffect(synchronize, [props.graph, props.night, props.query, props.selected, props.saved]);
  return <><iframe key={revision} ref={frame} title="芝士库" className="orbit-library-frame"
    style={{ visibility: recovery!=='failed'&&paintedDocument === document ? 'visible' : 'hidden' }}
    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcDoc={document} onLoad={synchronize}/>
    {recovery!=='idle'&&<div className="orbit-recovery" role="status">
      <p>{recovery==='failed'?'画布暂时未能加载 你的收藏仍已保存':'正在恢复芝士库…'}</p>
      {recovery==='failed'&&<div><button type="button" onClick={()=>restart(true)}>重新加载画布</button><a href="/manage">查看收藏</a></div>}
    </div>}
  </>;
}
