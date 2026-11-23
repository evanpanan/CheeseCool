'use client';

import { useEffect, useMemo, useRef } from 'react';
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
  latest.current = props;
  const document = useMemo(() => orbitDocument.replace('__PAYLOAD__',
    'window.__cheesecool=' + JSON.stringify(props.graph).replace(/</g, '\\u003c') + ';'), [props.graph]);

  function synchronize() {
    const value = latest.current;
    frame.current?.contentWindow?.postMessage({
      type: 'cheesecool:state', mode: value.night ? 'dark' : 'light',
      query: value.query, paused: value.paused, focus: value.selected, saved: value.saved,
    }, '*');
  }

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'cheesecool:ready') synchronize();
      if (event.data?.type === 'cheesecool:select' && typeof event.data.id === 'string') latest.current.onSelect(event.data.id);
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  useEffect(synchronize, [props.night, props.query, props.paused, props.selected, props.saved]);
  return <iframe ref={frame} title="芝士库" className="orbit-library-frame"
    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcDoc={document} onLoad={synchronize}/>;
}
