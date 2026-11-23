import { useEffect, useRef, type PointerEvent } from 'react';
import type { Camera } from './use-spatial-graph';

type Point = { x: number; y: number };
type TouchEvent = PointerEvent<SVGSVGElement>;
type Pinch = { view: Camera; inverse: DOMMatrix; anchor: Point; distance: number };

function centerOf(touches: Map<number, Point>, inverse: DOMMatrix) {
  const [a, b] = touches.values();
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  return {
    x: inverse.a * x + inverse.c * y + inverse.e,
    y: inverse.b * x + inverse.d * y + inverse.f,
    distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
  };
}

// The initial inverse matrix includes SVG letterboxing as well as CSS viewport offsets.
// Keep it for the entire pinch so updates remain correct even between React commits.
export function usePinchZoom(view: Camera, fitWidth: number, setView: (camera: Camera) => void, onStart: () => void) {
  const touches = useRef(new Map<number, Point>());
  const pinching = useRef(false);
  const start = useRef<Pinch | null>(null);

  useEffect(() => {
    const points = touches.current;
    function clear() { points.clear(); pinching.current = false; start.current = null; }
    function visibility() { if (document.hidden) clear(); }
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', visibility);
      clear();
    };
  }, []);

  function rebase(svg: SVGSVGElement) {
    start.current = null;
    if (touches.current.size !== 2) return;
    const matrix = svg.getScreenCTM();
    if (!matrix || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-9) return;
    const inverse = matrix.inverse();
    const anchor = centerOf(touches.current, inverse);
    const box = svg.viewBox?.animVal;
    const camera = box?.width && box.height
      ? { ...view, x: box.x, y: box.y, width: box.width, height: box.height }
      : view;
    start.current = { view: camera, inverse, anchor, distance: anchor.distance };
  }

  function consume(event: TouchEvent) {
    event.stopPropagation();
    event.preventDefault();
  }

  function down(event: TouchEvent) {
    if (event.pointerType !== 'touch') return;
    if (event.isPrimary && touches.current.size) {
      touches.current.clear();
      pinching.current = false;
      start.current = null;
    }
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!pinching.current && touches.current.size < 2) return;
    const svg = event.currentTarget;
    rebase(svg);
    if (!pinching.current) {
      pinching.current = true;
      onStart();
    }
    for (const id of touches.current.keys()) svg.setPointerCapture(id);
    consume(event);
  }

  function move(event: TouchEvent) {
    if (!touches.current.has(event.pointerId)) return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!pinching.current) return;
    consume(event);
    const base = start.current;
    if (!base) return;
    const point = centerOf(touches.current, base.inverse);
    const width = Math.min(fitWidth * 2, Math.max(Math.min(65, fitWidth / 3), base.view.width * base.distance / point.distance));
    const ratio = width / base.view.width;
    setView({
      ...base.view, x: base.anchor.x - (point.x - base.view.x) * ratio,
      y: base.anchor.y - (point.y - base.view.y) * ratio, width, height: base.view.height * ratio,
    });
  }

  function end(event: TouchEvent) {
    if (!touches.current.delete(event.pointerId) || !pinching.current) return;
    consume(event);
    rebase(event.currentTarget);
    if (!touches.current.size) pinching.current = false;
  }

  return {
    onPointerDownCapture: down, onPointerMoveCapture: move, onPointerUpCapture: end, onPointerCancelCapture: end,
    onLostPointerCaptureCapture(event: TouchEvent) {
      // Taking capture from a child node also bubbles a loss event through the SVG.
      if (event.target === event.currentTarget) end(event);
    },
  };
}
