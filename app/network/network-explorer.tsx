'use client';

import { useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { buildNetwork, type NetworkBookmark, type NetworkEdge } from '@/lib/knowledge-network';
import { platformNames } from '@/lib/urls';
import { Icon } from '../icons';
import { CheeseBadge, CheeseSlice } from './cheese-node';

type Camera = { x: number; y: number; width: number; height: number };
const gold = '#efa92b';
const shorten = (title: string, length: number) =>
  title.length > length ? title.slice(0, length) + '…' : title;

export function NetworkExplorer({ bookmarks, edges }: { bookmarks: NetworkBookmark[]; edges: NetworkEdge[] }) {
  const graph = useMemo(() => buildNetwork(bookmarks, edges), [bookmarks, edges]);
  const byId = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph]);
  const groupById = useMemo(() => new Map(graph.groups.map(group => [group.key, group])), [graph]);
  const [groupKey, setGroupKey] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [night, setNight] = useState(false);
  const [local, setLocal] = useState(false);
  const [hoveredId, setHoveredId] = useState('');
  const [camera, setCamera] = useState<Camera | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const searchId = useId();
  const detailRef = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; scale: number; view: Camera } | null>(null);

  const group = groupById.get(groupKey);
  const selected = byId.get(selectedId);
  const selectedNeighbors = new Set(selected?.connections.map(item => item.id));
  const inFocus = local && Boolean(selected);
  const hovered = byId.get(hoveredId);
  const displayed = inFocus && selected
    ? [selected, ...selected.connections.flatMap(item => byId.get(item.id) ?? [])]
    : group?.nodes ?? graph.nodes;
  const visibleIds = new Set(displayed.map(node => node.id));
  const visibleLinks = graph.links.filter(edge => visibleIds.has(edge.source_id) && visibleIds.has(edge.target_id));
  const highlighted = [...displayed].sort((a, b) => b.degree - a.degree).filter(node => node.degree > 0).slice(0, 5);
  const hubs = new Set(highlighted.slice(0, 3).map(node => node.id));
  const phrase = query.trim().toLowerCase();
  const matches = phrase ? graph.nodes.filter(node => [node.title, ...node.tags].some(value => value.toLowerCase().includes(phrase))) : [];
  const span = Math.max(175, group?.span ?? 0);
  let fit = group
    ? { x: group.x - span / 2, y: group.y - span / 2, width: span, height: span }
    : { x: 0, y: 0, width: graph.width, height: graph.height };
  if (inFocus && selected) {
    const reach = Math.max(95, ...displayed.map(node => Math.hypot(node.x - selected.x, node.y - selected.y) + 36));
    fit = { x: selected.x - reach, y: selected.y - reach, width: reach * 2, height: reach * 2 };
  }
  const view = camera ?? fit;

  function clearDetail() {
    setSelectedId('');
    if (local) setCamera(null);
    setLocal(false);
  }

  function toggleFocus() {
    if (local) setSelectedId('');
    setLocal(!local);
    setHoveredId('');
    setCamera(null);
  }

  function zoom(factor: number) {
    setCamera(current => {
      const view = current ?? fit;
      const width = Math.min(fit.width * 2, Math.max(Math.min(65, fit.width / 3), view.width * factor));
      const height = view.height * width / view.width;
      return { x: view.x + (view.width - width) / 2, y: view.y + (view.height - height) / 2, width, height };
    });
  }

  function startPan(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest('[data-node]')) return;
    const matrix = svg.current?.getScreenCTM();
    if (!matrix?.a) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, view, scale: matrix.a };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pan(event: PointerEvent<SVGSVGElement>) {
    const origin = drag.current;
    if (origin?.id !== event.pointerId) return;
    setCamera({
      ...origin.view,
      x: origin.view.x - (event.clientX - origin.x) / origin.scale,
      y: origin.view.y - (event.clientY - origin.y) / origin.scale,
    });
  }

  function showDetail(id: string) {
    if (!id) {
      clearDetail();
      return;
    }
    setQuery('');
    setSelectedId(id);
    if (local) setCamera(null);
    if (id && window.matchMedia('(max-width: 760px)').matches) {
      detailRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }

  function reveal(id: string) {
    const node = byId.get(id);
    if (!node) return;
    if (groupKey && groupKey !== node.group) setGroupKey('');
    const size = 230;
    if (!local) setCamera({ x: node.x - size / 2, y: node.y - size / 2, width: size, height: size });
    setQuery('');
    showDetail(id);
  }

  return <div className="network-grid atlas-workspace" data-night={night}>
    <section className="atlas-panel" aria-label="可交互芝士图谱">
      <div className="network-toolbar">
        <label className="network-filter">
          <span className="sr-only">主题</span>
          <select value={groupKey} onChange={event => {
            setGroupKey(event.target.value);
            setSelectedId('');
            setLocal(false);
            setHoveredId('');
            setCamera(null);
          }}>
            <option value="">全部主题</option>
            {graph.groups.map(item => <option key={item.key} value={item.key}>{item.label}（{item.size}）</option>)}
          </select>
        </label>
        {inFocus && <button className="atlas-back" type="button" onClick={toggleFocus}>← 返回全图</button>}
        <div className="atlas-totals"><span>{displayed.length} 条收藏</span><span>{visibleLinks.length} 条关联</span></div>
        <button className="atlas-mode" type="button" role="switch" aria-checked={night} aria-label="星图模式" onClick={() => setNight(value => !value)}>
          <span aria-hidden="true">{night ? '☀' : '☾'}</span> {night ? '浅色画布' : '星图模式'}
        </button>
      </div>

      <div className="network-canvas" data-night={night}>
        <svg ref={svg} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
          aria-label="奶酪收藏节点和关联连线"
          onPointerDown={startPan} onPointerMove={pan}
          onLostPointerCapture={() => { drag.current = null; }}
          onKeyDown={event => { if (event.key === 'Escape') clearDetail(); }}>
          {visibleLinks.map(edge => {
            const from = byId.get(edge.source_id)!;
            const to = byId.get(edge.target_id)!;
            const focused = selectedId === from.id || selectedId === to.id ||
              (!selected && (hoveredId === from.id || hoveredId === to.id));
            const crossTheme = from.group !== to.group;
            return <line key={from.id + ':' + to.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              className={focused ? 'atlas-focused-edge' : crossTheme ? 'atlas-cross-edge' : undefined}
              stroke={from.color} vectorEffect="non-scaling-stroke"
              strokeDasharray={edge.kind === 'tag' ? '1.6 3.2' : undefined}
              strokeWidth={focused ? 1.45 : .35 + edge.score * .52}
              opacity={focused ? .9 : selected && !inFocus ? .07 : edge.kind === 'tag' ? .20 : .19 + edge.score * .19}/>;
          })}
          {!selected && group && <text x={group.x} y={group.top - 19} textAnchor="middle"
            className="network-label" fill={group.color}>{shorten(group.label, 16)}</text>}
          {displayed.map(node => {
            const active = selectedId === node.id;
            const hub = !inFocus && hubs.has(node.id);
            const color = active || hub ? gold : node.color;
            const radius = node.radius * (active ? 1.48 : hub ? 1.35 : .76);
            return <g key={node.id} data-node role="button" tabIndex={0} aria-label={node.title}
              aria-pressed={active} opacity={selected && !active && !selectedNeighbors.has(node.id) ? .23 : 1}
              transform={`translate(${node.x} ${node.y})`}
              onPointerEnter={event => { if (event.pointerType !== 'touch') setHoveredId(node.id); }}
              onPointerLeave={() => setHoveredId(value => value === node.id ? '' : value)}
              onClick={() => showDetail(active ? '' : node.id)} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  showDetail(active ? '' : node.id);
                }
              }}>
              <title>{node.title}</title>
              <circle className="atlas-hit-area" r={Math.max(radius + 3, 6)} fill="transparent"/>
              {(hub || active) && <circle className="atlas-node-halo" r={radius + 7} fill={gold}/>}
              <CheeseSlice className="atlas-node-glyph" color={color} size={radius / 9}
                detailed={active || hub || (view.width < 480 && node.radius > 3)}/>
            </g>;
          })}
          {!selected && hovered && visibleIds.has(hovered.id) && <text
            x={hovered.x} y={hovered.y - hovered.radius - 12} textAnchor="middle"
            className="atlas-selected-label">{shorten(hovered.title, 24)}</text>}
          {selected && visibleIds.has(selected.id) && <text x={selected.x} y={selected.y + selected.radius * 1.35 + 20}
            textAnchor="middle" className="atlas-selected-label">{shorten(selected.title, 22)}</text>}
        </svg>
        <div className="network-zoom" aria-label="图谱缩放">
          <button type="button" aria-label="放大" onClick={() => zoom(.72)}>＋</button>
          <button type="button" aria-label="缩小" onClick={() => zoom(1 / .72)}>−</button>
          <button type="button" aria-label="适合画布" title="适合画布" onClick={() => setCamera(null)}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M9 4H4v5m11-5h5v5m0 6v5h-5M4 15v5h5"/></svg>
          </button>
        </div>
      </div>
      <div className="network-legend">
        <span><i className="atlas-hub-key"/>重点收藏</span><span><i/>语义关联</span><span><i className="atlas-dashed-key"/>共同标签</span>
      </div>
    </section>

    <aside ref={detailRef} className="network-inspector" aria-label="收藏详情">
      <form className="atlas-search" role="search" onSubmit={event => {
        event.preventDefault();
        if (matches[0]) reveal(matches[0].id);
      }}>
        <label htmlFor={searchId} className="sr-only">查找图中收藏</label>
        <Icon name="search" size={17}/>
        <input id={searchId} type="search" value={query} maxLength={100}
          onChange={event => setQuery(event.target.value)} placeholder="查找收藏或主题"/>
      </form>
      {phrase ? <>
        <h2>搜索结果 <span className="atlas-count">{matches.length}</span></h2>
        {matches.length ? <ul className="network-list">
          {matches.slice(0, 30).map(node => <li key={node.id}>
            <button type="button" onClick={() => reveal(node.id)}><CheeseBadge color={node.color}/><span>{node.title}</span></button>
          </li>)}
        </ul> : <p>没有找到匹配的收藏。</p>}
      </> : selected ? <>
        <div className="network-detail-heading">
          <span><CheeseBadge color={gold}/>{platformNames[selected.platform]} · {groupById.get(selected.group)?.label}</span>
          <button type="button" className="icon-button" aria-label="关闭详情" onClick={clearDetail}><Icon name="close" size={17}/></button>
        </div>
        <h2>{selected.title}</h2>
        {(selected.ai_summary || selected.summary) && <p>{selected.ai_summary || selected.summary}</p>}
        {!!selected.tags.length && <ul className="network-tags" aria-label="标签">
          {selected.tags.map((tag, index) => <li key={index}>{tag}</li>)}
        </ul>}
        <a className="network-source" href={selected.final_url || selected.original_url} target="_blank" rel="noopener noreferrer">
          打开原文 <Icon name="arrow" size={14}/>
        </a>
        <button type="button" className="atlas-focus-button" onClick={toggleFocus} disabled={!inFocus && !selected.connections.length}>
          {inFocus ? '返回全图' : '聚焦关系'}
        </button>
        <h3>相关收藏 <span className="atlas-count">{selected.connections.length}</span></h3>
        {!!selected.connections.length && <ul className="network-list">
          {selected.connections.map(item => <li key={item.id}>
            <button type="button" onClick={() => reveal(item.id)}><span>{byId.get(item.id)?.title}</span>
              <small>{item.kind === 'tag' ? '共同标签' : '语义'}</small></button>
          </li>)}
        </ul>}
        {!selected.connections.length && <p>当前视图里暂无关联。</p>}
      </> : <>
        <h2>重点收藏</h2>
        <p>{highlighted.length ? '点开连接最多的收藏，沿着关联继续探索。' : '生成标签或完成语义索引后，相关收藏会连起来。'}</p>
        {!!highlighted.length && <ul className="network-list atlas-highlights">
          {highlighted.map(node => <li key={node.id}>
            <button type="button" onClick={() => reveal(node.id)}>
              <CheeseBadge color={gold}/>
              <span>{node.title}<small>{groupById.get(node.group)?.label} · {node.degree} 条关联</small></span>
              <Icon name="arrow" size={14}/>
            </button>
          </li>)}
        </ul>}
      </>}
    </aside>
  </div>;
}
