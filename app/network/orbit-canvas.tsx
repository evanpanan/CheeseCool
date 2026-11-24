'use client';

import { useEffect, useRef, useState } from 'react';
import { orbitDocument } from '@/lib/orbit-document';
import type { buildNetwork } from '@/lib/knowledge-network';

type Props = {
  graph: ReturnType<typeof buildNetwork>;
  night: boolean;
  query: string;
  paused: boolean;
  selected: string;
  saved: { id: string; event: number } | null;
  onSelect: (id: string) => void;
};

export function OrbitCanvas(props: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  const locatedSave = useRef('');
  const icons = useRef<Record<string,string>>({});
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
    frame.current?.contentWindow?.postMessage({
      type: 'cheesecool:state', mode: window.document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
      query: value.query, paused: value.paused, focus: value.selected,
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
    const controller=new AbortController();let alive=true;
    const node=props.graph.nodes.find(n=>n.id===props.selected);
    if(!node||icons.current[node.id]||(node.record_type&&node.record_type!=='web'))return;
    async function loadDetailIcon(){
      try{
        const response=await fetch('/api/site-icon?id='+encodeURIComponent(node!.id),{signal:controller.signal});
        if(!response.ok||response.status===204||response.headers.get('content-type')!=='image/png')return;
        const blob=await response.blob();if(blob.size>65536)return;
        const value=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('icon'));reader.readAsDataURL(blob);});
        if(!alive)return;icons.current[node!.id]=value;
        frame.current?.contentWindow?.postMessage({type:'cheesecool:icons',icons:{[node!.id]:value}},'*');
      }catch{/* source identity is optional; the constellation never waits for a favicon */}
    }
    void loadDetailIcon();
    return()=>{alive=false;controller.abort();};
  },[props.graph,props.selected]);

  useEffect(synchronize, [props.graph, props.night, props.query, props.paused, props.selected, props.saved]);
  return <><iframe key={revision} ref={frame} title="芝士库" className="orbit-library-frame"
    style={{ visibility: recovery!=='failed'&&paintedDocument === document ? 'visible' : 'hidden' }}
    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcDoc={document} onLoad={synchronize}/>
    {recovery!=='idle'&&<div className="orbit-recovery" role="status">
      <p>{recovery==='failed'?'画布暂时未能加载 你的收藏仍已保存':'正在恢复芝士库…'}</p>
      {recovery==='failed'&&<div><button type="button" onClick={()=>restart(true)}>重新加载画布</button><a href="/manage">查看收藏</a></div>}
    </div>}
  </>;
}
