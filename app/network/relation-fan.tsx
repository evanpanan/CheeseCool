'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { buildNetwork } from '@/lib/knowledge-network';
import { CheeseBadge } from './cheese-node';
import './relation-fan.css';

type CollectionNode = ReturnType<typeof buildNetwork>['nodes'][number];
type FanProps = {
  selected: CollectionNode;
  byId: ReadonlyMap<string, CollectionNode>;
  onSelect: (id: string) => void;
  onExit: () => void;
};

const pageSize = 6;
const normalizeTag = (tag: string) => tag.trim().normalize('NFKC').toLowerCase();

function Chevron({ back = false }: { back?: boolean }) {
  return <svg className="fan-chevron" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d={back ? 'M10 3 5 8l5 5' : 'm6 3 5 5-5 5'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}

export function RelationFan({ selected, byId, onSelect, onExit }: FanProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const labelId = useId();
  const [history, setHistory] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [hovered, setHovered] = useState('');
  const [focused, setFocused] = useState('');
  const activeId = hovered || focused;
  const tags = new Set(selected.tags.map(normalizeTag));
  const neighbors = selected.connections.flatMap(edge => {
    const node = byId.get(edge.id);
    return node ? [{ node, kind: edge.kind }] : [];
  });
  const pageCount = Math.ceil(neighbors.length / pageSize);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const group = neighbors.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [selected.id]);

  function navigate(id: string, forward: boolean) {
    setHistory(previous => forward ? [...previous, selected.id] : previous.slice(0, -1));
    setPage(0);
    setFocused('');
    setHovered('');
    onSelect(id);
  }

  return <section className="relation-fan" aria-labelledby={labelId} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onExit(); }
  }}>
    <div className="relation-fan-pane">
      <nav className="fan-navigation" aria-label="关系浏览">
        <button type="button" onClick={onExit}><Chevron back/>返回全图</button>
        {history.length > 0 && <button type="button" onClick={() => navigate(history[history.length - 1], false)}>上一个节点</button>}
      </nav>
      <div className="fan-reading-area">
        <div className="fan-diagram" key={selected.id}>
          <div className="fan-origin">
            <CheeseBadge color="#f4b83e"/>
            <h2 id={labelId} ref={heading} tabIndex={-1}>{selected.title}</h2>
            <p className="fan-count">{neighbors.length} 条直接关联</p>
            {(selected.ai_summary || selected.summary) && <p className="fan-summary">{selected.ai_summary || selected.summary}</p>}
          </div>
          {group.length > 0 && <svg className="fan-wires" viewBox={`0 0 100 ${group.length * 64}`} preserveAspectRatio="none" aria-hidden="true">
            {group.map(({ node }, index) => {
              const y = index * 64 + 32;
              const middle = group.length * 32;
              return <g key={node.id} className={activeId === node.id ? 'is-active' : undefined}>
                <path className="fan-landscape-wire" d={`M0 ${middle} C42 ${middle} 57 ${y} 100 ${y}`} vectorEffect="non-scaling-stroke"/>
                <path className="fan-handheld-wire" d={`M4 0 V${y - 12} Q4 ${y} 32 ${y} H100`} vectorEffect="non-scaling-stroke"/>
              </g>;
            })}
          </svg>}
          <ul className="fan-destinations" aria-label="直接关联的收藏">
            {group.map(({ node, kind }) => {
              const matching = [...new Set(node.tags.filter(tag => tags.has(normalizeTag(tag))))];
              const evidence = matching.length ? `共同标签 · ${matching.join('、')}` : kind === 'tag' ? '标签关联' : '语义相近';
              return <li key={node.id}>
                <button type="button" onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(node.id); }}
                  onPointerLeave={() => setHovered('')} onFocus={() => setFocused(node.id)} onBlur={() => setFocused('')}
                  onClick={() => navigate(node.id, true)}>
                  <span className="fan-destination-copy"><strong>{node.title}</strong><small>{evidence}</small></span>
                  <Chevron/>
                </button>
              </li>;
            })}
          </ul>
        </div>
        {pageCount > 1 && <div className="fan-pagination" aria-label="关联分页">
          <button type="button" disabled={currentPage === 0} aria-label="上一页关联" onClick={() => setPage(currentPage - 1)}><Chevron back/></button>
          <span aria-live="polite">{currentPage + 1} / {pageCount}</span>
          <button type="button" disabled={currentPage === pageCount - 1} aria-label="下一页关联" onClick={() => setPage(currentPage + 1)}><Chevron/></button>
        </div>}
      </div>
    </div>
  </section>;
}
