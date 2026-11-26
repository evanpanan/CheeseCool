'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildNetwork, type NetworkBookmark, type NetworkEdge } from '@/lib/knowledge-network';
import { particleStory } from '@/lib/cheese-particles';
import { useWorkspaceActivity } from '../workspace-activity';
import { useAppearance } from '../theme-switch';
import { CheeseSculpture } from '../auth/cheese-sculpture';
import { OrbitCanvas } from './orbit-canvas';
import { GenerativeText } from '../generative-text';

const emptyHeadlines = ['让第一个灵感落在这里', '把好东西都存起来', '让收藏长出新的灵感', '从一个链接开始连接'];

export function NetworkExplorer({ bookmarks, edges }: {
  bookmarks: NetworkBookmark[]; edges: NetworkEdge[]; relationMessage?: string;
}) {
  const { composing, savedBookmark, search } = useWorkspaceActivity();
  const night = useAppearance() === 'dark';
  const [selected, setSelected] = useState('');
  const [emptyPhase,setEmptyPhase]=useState(1);
  const [headline, setHeadline] = useState(0);
  const handledSave = useRef<typeof savedBookmark>(null);
  const allBookmarks = useMemo(() => [...new Map([...bookmarks, ...(search?.bookmarks ?? [])]
    .map(item => [item.id, item])).values()], [bookmarks, search]);
  const allEdges = useMemo(() => [...new Map([...edges, ...(search?.edges ?? [])]
    .map(item => [[item.source_id, item.target_id].sort().join(':'), item])).values()], [edges, search]);
  const graph = useMemo(() => buildNetwork(allBookmarks, allEdges), [allBookmarks, allEdges]);

  useEffect(() => {
    if (!savedBookmark || savedBookmark === handledSave.current || !graph.nodes.some(node => node.id === savedBookmark.id)) return;
    handledSave.current = savedBookmark;
    setSelected('');
  }, [savedBookmark, graph]);

  useEffect(() => setSelected(''), [search]);

  const isEmpty = !graph.nodes.length && !search;
  useEffect(() => {
    if (!isEmpty || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setHeadline(value => (value + 1) % emptyHeadlines.length), 5200);
    return () => window.clearInterval(timer);
  }, [isEmpty]);

  if (isEmpty) {
    return <section className="workspace-empty hero" aria-labelledby="hero-title"><div className="intelligent-empty"><CheeseSculpture shape={particleStory[emptyPhase].shape} onActivate={()=>setEmptyPhase(value=>(value+1)%particleStory.length)}/><h1 id="hero-title" aria-label={emptyHeadlines[headline]}><GenerativeText text={emptyHeadlines[headline]} paused={composing}/></h1></div></section>;
  }

  return <section className="reference-library-page" aria-label="芝士库">
    <OrbitCanvas graph={graph} night={night} query={search?.query ?? ''}
      selected={selected} saved={savedBookmark} onSelect={id => { if (!id || graph.nodes.some(node => node.id === id)) setSelected(id); }}/>
  </section>;
}
