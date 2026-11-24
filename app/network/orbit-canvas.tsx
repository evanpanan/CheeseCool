'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  latest.current = props;
  const document = useMemo(() => orbitDocument.replace('__PAYLOAD__',
    'window.__cheesecool=' + JSON.stringify(props.graph).replace(/</g, '\\u003c') + ';'), [props.graph]);
  const currentDocument = useRef(document);
  currentDocument.current = document;
  const [paintedDocument, setPaintedDocument] = useState('');

  function synchronize() {
    const value = latest.current;
    frame.current?.contentWindow?.postMessage({
      type: 'cheesecool:state', mode: value.night ? 'dark' : 'light',
      query: value.query, paused: value.paused, focus: value.selected,
      saved: value.saved && `${value.saved.id}:${value.saved.event}` !== locatedSave.current ? value.saved : null,
    }, '*');
  }

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'cheesecool:ready') synchronize();
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
    return () => window.removeEventListener('message', receive);
  }, []);

  useEffect(synchronize, [props.night, props.query, props.paused, props.selected, props.saved]);
  return <iframe ref={frame} title="芝士库" className="orbit-library-frame"
    style={{ visibility: paintedDocument === document ? 'visible' : 'hidden' }}
    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcDoc={document} onLoad={synchronize}/>;
}
