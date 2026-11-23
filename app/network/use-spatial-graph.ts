import { useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { forceLink, forceManyBody } from 'd3-force';
import { createNetworkPhysics, type PhysicsNode, type PhysicsLink } from '@/lib/network-physics';
import { createProjection, depthForBookmark } from '@/lib/network-projection';
import { LabelGrid } from '@/lib/network-labels';

export type Camera = { x: number; y: number; width: number; height: number; anchorId?: string };
type ScreenPoint = { x: number; y: number; scale: number };

function textBounds(text: SVGTextElement, fallbackSize: number) {
  // Text is measured once per render, never during a simulation frame. getBBox
  // also measures the smaller number in a topic label and actual CJK glyphs.
  try {
    const box = text.getBBox();
    if (box.width > 0 && box.height > 0) return box;
  } catch { /* A hidden or non-rendering SVG may not provide font metrics. */ }
  const width = Array.from(text.textContent || '').length * fallbackSize;
  return {
    x: Number(text.getAttribute('x')) - width / 2,
    y: Number(text.getAttribute('y')) + Number(text.getAttribute('dy')) - fallbackSize,
    width, height: fallbackSize * 1.2,
  };
}
const motionQuery = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (callback: () => void) => {
  const preference = window.matchMedia(motionQuery);
  preference.addEventListener('change', callback);
  return () => preference.removeEventListener('change', callback);
};
export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => true);
}

export function useSpatialGraph(
  svg: RefObject<SVGSVGElement | null>,
  night: boolean,
  autoMove: boolean,
  view: Camera,
  _fitWidth: number,
  center: { x: number; y: number },
  charge = -450,
  distance = 140,
) {
  const reducedMotion = useReducedMotion();
  const engine = useRef<ReturnType<typeof createNetworkPhysics> | null>(null);
  const topology = useRef('');
  const held = useRef<string | undefined>(undefined);
  const dragging = useRef(false);
  const invalidate = useRef<() => void>(() => {});
  const resumeAt = useRef(0);
  const phase = useRef(0);
  const blend = useRef(night ? 1 : 0);
  const projected = useRef(new Map<string, ScreenPoint>());
  const depths = useRef(new Map<string, number>());
  const labelMetrics = useRef(new WeakMap<SVGTextElement, { key: string; bounds: ReturnType<typeof textBounds> }>());
  const projection = useRef(createProjection(0, 0, center, center.x * 2));

  // The physical world persists across React renders, including theme/selection changes.
  useLayoutEffect(() => {
    const element = svg.current;
    if (!element) return;
    const canvas = element.parentElement;
    const rendered = [...element.querySelectorAll<SVGGElement>('[data-orbit-node]')];
    const inputs = rendered.map(node => ({ id: node.dataset.orbitNode!, x: Number(node.dataset.x), y: Number(node.dataset.y), radius: Number(node.dataset.radius) || 22 }));
    const paths = [...element.querySelectorAll<SVGPathElement>('[data-orbit-from]')];
    const edges = paths.map(path => ({ source: path.dataset.orbitFrom!, target: path.dataset.orbitTo! }));
    const key = JSON.stringify([inputs.map(node => [node.id, node.x, node.y]), edges.map(edge => [edge.source, edge.target])]);
    if (key !== topology.current || !engine.current) {
      engine.current?.simulation.stop();
      engine.current = createNetworkPhysics(inputs, edges, charge, distance);
      if (reducedMotion) engine.current.simulation.tick(240).alpha(0);
      topology.current = key;
      held.current = undefined;
      dragging.current = false;
    }
    const { simulation, nodes } = engine.current;
    const byId = new Map(nodes.map(node => [node.id, node]));
    depths.current.clear();
    projected.current.clear();
    const visuals = rendered.map(node => {
      const id = node.dataset.orbitNode!;
      const depth = depthForBookmark(id, Number(node.dataset.group) || 0);
      depths.current.set(id, depth);
      const brightness = night && node.dataset.importance !== 'hub' && node.getAttribute('aria-pressed') !== 'true'
        ? (.84 + .16 * depth).toFixed(3) : '';
      node.style.fillOpacity = brightness;
      return { node, point: byId.get(id)!, depth, radius: Number(node.dataset.radius) || 22 };
    });
    const clusters = new Map<number, { x: number; y: number; count: number }>();
    rendered.forEach((element, index) => {
      const group = Number(element.dataset.group) || 0;
      const point = nodes[index];
      const value = clusters.get(group) ?? { x: 0, y: 0, count: 0 };
      value.x += point.homeX; value.y += point.homeY; value.count++;
      clusters.set(group, value);
    });
    for (const value of clusters.values()) { value.x /= value.count; value.y /= value.count; }
    const orbitalHomes = new Map(visuals.map(({ node, point }, index) => {
      const cluster = clusters.get(Number(node.dataset.group) || 0)!;
      return [point.id, { cluster, dx: point.homeX - cluster.x, dy: point.homeY - cluster.y, index }];
    }));
    const fontSize = parseFloat(element.style.getPropertyValue('--graph-label-size')) || 15;
    const labelGrid = new LabelGrid(Math.max(16, fontSize * 5));
    const labels = [...element.querySelectorAll<SVGTextElement>('[data-orbit-label], [data-relation-from]')].map(label => {
      const source = label.dataset.orbitLabel || label.dataset.relationFrom!;
      const target = label.dataset.relationTo;
      const priority = label.dataset.labelPriority === 'active' ? 0 : label.dataset.labelPriority === 'topic' ? 1 : target ? 2 : 3;
      const x = label.getAttribute('x'), y = label.getAttribute('y');
      const metricKey = [x, y, label.getAttribute('dy'), fontSize, night, label.textContent].join('|');
      let metrics = labelMetrics.current.get(label);
      if (metrics?.key !== metricKey) {
        metrics = { key: metricKey, bounds: textBounds(label, fontSize) };
        labelMetrics.current.set(label, metrics);
      }
      const world = byId.get(source)!;
      const offsetX = Number(x) - world.homeX, offsetY = Number(y) - world.homeY;
      const opacity = Number(label.getAttribute('opacity') ?? 1);
      return { label, source, target, priority, opacity, bounds: metrics.bounds, world, offsetX, offsetY, hidden: label.style.visibility === 'hidden' };
    }).sort((a, b) => a.priority - b.priority || b.opacity - a.opacity);
    const radii = new Map(visuals.map(({ point, radius }) => [point.id, radius]));
    const anchor = view.anchorId ? byId.get(view.anchorId) : undefined;
    const origin = anchor ?? center;
    const span = Math.min(center.x, center.y) * 2;
    const targetBlend = night ? 1 : 0;
    if (reducedMotion) blend.current = targetBlend;
    let frame = 0;
    let wakeTimer = 0;
    let last = 0;
    let visible = true;
    let hovered = Boolean(element.querySelector('[data-node]:hover') && window.matchMedia('(hover: hover)').matches);

    function draw() {
      const transform = createProjection(phase.current, blend.current, origin, span);
      projection.current = transform;
      for (const { node, point, depth } of visuals) {
        const home = orbitalHomes.get(point.id)!;
        // Orbit the cluster's layout, leaving D3's elastic displacement independent.
        // Pausing the phase during a gesture keeps the inverse drag exact.
        const angle = Math.sin(phase.current * 1.1) * .22 * blend.current;
        const driftX = (Math.cos(angle) - 1) * home.dx - Math.sin(angle) * home.dy;
        const driftY = Math.sin(angle) * home.dx + (Math.cos(angle) - 1) * home.dy;
        const bobX = (Math.sin(phase.current * 3 + home.index * 1.6) - Math.sin(home.index * 1.6)) * 12 * blend.current;
        const bobY = (Math.cos(phase.current * 2.6 + home.index) - Math.cos(home.index)) * 12 * blend.current;
        const screen = transform.project({ x: point.x + driftX + bobX, y: point.y + driftY + bobY }, depth);
        projected.current.set(point.id, screen);
        node.setAttribute('transform', `translate(${screen.x.toFixed(2)} ${screen.y.toFixed(2)}) scale(${screen.scale.toFixed(4)})`);
      }
      for (const path of paths) {
        const source = path.dataset.orbitFrom!, target = path.dataset.orbitTo!;
        const a = projected.current.get(source)!, b = projected.current.get(target)!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const length = Math.hypot(dx, dy) || 1;
        const padA = Math.min((radii.get(source)! * .84 + 3) * a.scale, length * .3);
        const padB = Math.min((radii.get(target)! * .84 + 3) * b.scale, length * .3);
        path.setAttribute('d', `M${(a.x + dx / length * padA).toFixed(2)},${(a.y + dy / length * padA).toFixed(2)} L${(b.x - dx / length * padB).toFixed(2)},${(b.y - dy / length * padB).toFixed(2)}`);
      }
      labelGrid.clear();
      for (const entry of labels) {
        const { source, target, world, bounds, label } = entry;
        const from = projected.current.get(source)!;
        const to = target ? projected.current.get(target) : null;
        const x = to ? (from.x + to.x) / 2 : from.x - world.homeX + entry.offsetX * (from.scale - 1);
        const y = to ? (from.y + to.y) / 2 : from.y - world.homeY + entry.offsetY * (from.scale - 1);
        // Require a little more space for a label to reappear, so a small
        // orbital motion at the collision boundary doesn't flicker the text.
        const padding = fontSize * (entry.hidden ? .28 : .15);
        const left = bounds.x + x, top = bounds.y + y;
        const visible = labelGrid.reserve({
          left: left - padding, right: left + bounds.width + padding,
          top: top - padding, bottom: top + bounds.height + padding,
        }, entry.priority === 0 || label === document.activeElement);
        if (entry.hidden === visible) {
          label.style.visibility = visible ? '' : 'hidden';
          entry.hidden = !visible;
        }
        if (visible) label.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      }
      if (canvas) {
        canvas.style.setProperty('--sky-offset-x', `${(Math.sin(phase.current) * blend.current * 12).toFixed(2)}px`);
        canvas.style.setProperty('--sky-offset-y', `${(Math.cos(phase.current) * blend.current * 6).toFixed(2)}px`);
      }
    }

    function allowsIdle() {
      return nodes.length > 1 && autoMove && !reducedMotion && !hovered && !dragging.current &&
        !element!.querySelector('[data-node]:focus-visible');
    }
    function schedule() {
      if (frame || !visible || document.hidden) return;
      const delay = resumeAt.current - performance.now();
      if (held.current || simulation.alpha() > .002 || blend.current !== targetBlend || (allowsIdle() && delay <= 0)) {
        frame = requestAnimationFrame(tick);
      } else if (!wakeTimer && allowsIdle() && delay > 0) {
        wakeTimer = window.setTimeout(() => { wakeTimer = 0; schedule(); }, delay + 1);
      }
    }
    function tick(time: number) {
      frame = 0;
      const elapsed = last ? Math.min(50, time - last) : 16.67;
      const interval = nodes.length > 350 ? 32 : 15;
      if (!last || elapsed >= interval) {
        last = time;
        const idle = allowsIdle() && time >= resumeAt.current;
        if (idle) phase.current += elapsed * .00023;
        // A short interpolated handoff lets the same node travel into depth on a theme change.
        if (!dragging.current) {
          blend.current += (targetBlend - blend.current) * (1 - Math.exp(-elapsed / 110));
          if (Math.abs(targetBlend - blend.current) < .002) blend.current = targetBlend;
        }
        const idlePhysics = idle && !night;
        simulation.alphaTarget(held.current ? .25 : idlePhysics ? .025 : 0);
        if (idlePhysics) nodes.forEach((node, i) => {
          node.vx = (node.vx ?? 0) + Math.sin(phase.current * 3 + i * 2.4) * .045;
          node.vy = (node.vy ?? 0) + Math.cos(phase.current * 2.6 + i * 1.7) * .045;
        });
        if (simulation.alpha() > .002 || idlePhysics || held.current) simulation.tick();
        draw();
      }
      schedule();
    }
    function hover(event: PointerEvent) {
      hovered = event.pointerType !== 'touch' && event.target instanceof Element && !!event.target.closest('[data-node]');
      schedule();
    }
    function leave() { hovered = false; schedule(); }
    function visibility() {
      if ((!visible || document.hidden) && frame) { cancelAnimationFrame(frame); frame = 0; }
      last = 0;
      schedule();
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; visibility(); });
    observer.observe(element);
    element.addEventListener('pointerover', hover);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('focusout', schedule);
    document.addEventListener('visibilitychange', visibility);
    invalidate.current = () => { draw(); schedule(); };
    draw(); schedule();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(wakeTimer);
      observer.disconnect();
      element.removeEventListener('pointerover', hover);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('focusout', schedule);
      document.removeEventListener('visibilitychange', visibility);
      invalidate.current = () => {};
    };
  });

  useLayoutEffect(() => {
    const model = engine.current;
    if (!model) return;
    model.simulation.force('charge', forceManyBody<PhysicsNode>().strength(charge).distanceMax(520));
    model.simulation.force<ReturnType<typeof forceLink<PhysicsNode, PhysicsLink>>>('link')?.distance(distance);
    model.simulation.alpha(.5);
    if (reducedMotion) model.simulation.tick(240).alpha(0);
    invalidate.current();
  }, [charge, distance, reducedMotion]);

  return {
    position(id: string) { return projected.current.get(id); },
    start(id?: string) {
      dragging.current = true;
      held.current = id;
      const point = engine.current?.nodes.find(node => node.id === id);
      if (point) { point.fx = point.x; point.fy = point.y; engine.current!.simulation.alpha(.35); }
      invalidate.current();
    },
    moveNode(id: string, dx: number, dy: number) {
      const point = engine.current?.nodes.find(node => node.id === id);
      if (!point) return;
      const delta = projection.current.worldDelta(dx, dy, depths.current.get(id) ?? 0);
      point.fx = (point.fx ?? point.x) + delta.x;
      point.fy = (point.fy ?? point.y) + delta.y;
      point.x = point.fx; point.y = point.fy;
      invalidate.current();
    },
    release() {
      const point = engine.current?.nodes.find(node => node.id === held.current);
      if (point) { point.fx = null; point.fy = null; engine.current!.simulation.alpha(.45); }
      held.current = undefined; dragging.current = false; resumeAt.current = performance.now() + 1800;
      if (reducedMotion && engine.current) engine.current.simulation.tick(240).alpha(0);
      invalidate.current();
    },
    reset() {
      phase.current = 0;
      const model = engine.current;
      if (model) {
        for (const point of model.nodes) { point.x = point.homeX; point.y = point.homeY; point.vx = 0; point.vy = 0; point.fx = null; point.fy = null; }
        model.simulation.alpha(.7);
        if (reducedMotion) model.simulation.tick(240).alpha(0);
      }
      invalidate.current();
    },
  };
}
