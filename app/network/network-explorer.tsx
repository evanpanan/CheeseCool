'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildNetwork, type NetworkBookmark, type NetworkEdge } from '@/lib/knowledge-network';
import { particleStory } from '@/lib/cheese-particles';
import { useWorkspaceActivity } from '../workspace-activity';
import { useAppearance } from '../theme-switch';
import { CheeseSculpture } from '../auth/cheese-sculpture';
import { AiSignal } from '../ai-signal';
import { OrbitCanvas } from './orbit-canvas';

export function NetworkExplorer({ bookmarks, edges }: {
  bookmarks: NetworkBookmark[]; edges: NetworkEdge[]; relationMessage?: string;
}) {
  const { composing, savedBookmark, search } = useWorkspaceActivity();
  const night = useAppearance() === 'dark';
  const [selected, setSelected] = useState('');
  const [emptyPhase,setEmptyPhase]=useState(1);
  const handledSave = useRef<typeof savedBookmark>(null);
  const allBookmarks = useMemo(() => [...new Map([...bookmarks, ...(search?.bookmarks ?? [])]
    .map(item => [item.id, item])).values()], [bookmarks, search]);
  const allEdges = useMemo(() => [...new Map([...edges, ...(search?.edges ?? [])]
    .map(item => [[item.source_id, item.target_id].sort().join(':'), item])).values()], [edges, search]);
  const graph = useMemo(() => buildNetwork(allBookmarks, allEdges), [allBookmarks, allEdges]);

  useEffect(() => {
    if (!savedBookmark || savedBookmark === handledSave.current || !graph.nodes.some(node => node.id === savedBookmark.id)) return;
    handledSave.current = savedBookmark;
    setSelected(savedBookmark.id);
  }, [savedBookmark, graph]);

  useEffect(() => setSelected(''), [search]);

  if (!graph.nodes.length && !search) {
    return <section className="workspace-empty hero" aria-labelledby="hero-title"><div className="intelligent-empty"><CheeseSculpture shape={particleStory[emptyPhase].shape} onActivate={()=>setEmptyPhase(value=>(value+1)%particleStory.length)}/><h1 id="hero-title">让第一个灵感，落在这里。</h1><p>在顶部存下链接，逐步建立属于你的芝士库。</p><span className="empty-prompt"><AiSignal size={16}/>粘贴链接 <kbd>↵</kbd> 收藏</span></div></section>;
  }

  return <section className="reference-library-page" aria-label="芝士库">
    <OrbitCanvas graph={graph} night={night} query={search?.query ?? ''} paused={composing}
      selected={selected} saved={savedBookmark} onSelect={id => { if (!id || graph.nodes.some(node => node.id === id)) setSelected(id); }}/>
  </section>;
}
