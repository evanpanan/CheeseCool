type Point = { x: number; y: number };

// Keep a topic near one depth plane, with a small variation between its bookmarks.
export function depthForBookmark(id: string, group: number) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  const variation = (hash >>> 0) / 0xffffffff * 2 - 1;
  return .66 * Math.sin(group * 2.4 + .5) + .34 * variation;
}

// Weak perspective keeps lettering upright and makes dragging exactly invertible.
// The camera orbits a small cone so clusters never flatten into an edge-on view.
export function createProjection(phase: number, blend: number, center: Point, span: number) {
  const yaw = blend * (.13 + .27 * Math.sin(phase));
  const pitch = blend * (.08 + .15 * Math.cos(phase));
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  const depthScale = Math.min(1150, Math.max(160, span)) * .17;
  const scaleFor = (depth: number) => 1 / (1 - depth * blend * .18 * cosY * cosP);

  return {
    project(point: Point, depth: number) {
      const dx = point.x - center.x, dy = point.y - center.y;
      const z = depth * depthScale;
      const scale = scaleFor(depth);
      return {
        x: center.x + (dx * cosY + z * sinY) * scale,
        y: center.y + (dy * cosP + dx * sinY * sinP - z * cosY * sinP) * scale,
        scale,
      };
    },
    worldDelta(dx: number, dy: number, depth: number) {
      const scale = scaleFor(depth);
      const x = dx / (scale * cosY);
      return { x, y: (dy / scale - x * sinY * sinP) / cosP };
    },
  };
}
