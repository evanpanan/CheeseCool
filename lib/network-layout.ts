import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';

type Node = { id: string; groupIndex: number; degree: number; radius: number; x: number; y: number };
type Edge = { source_id: string; target_id: string; score: number; kind?: 'tag' };

const goldenAngle = Math.PI * (3 - Math.sqrt(5));

function components(nodes: Node[], edges: Edge[]) {
  const adjacency = new Map(nodes.map(node => [node.id, [] as string[]]));
  for (const edge of edges) {
    adjacency.get(edge.source_id)?.push(edge.target_id);
    adjacency.get(edge.target_id)?.push(edge.source_id);
  }
  const remaining = new Set(adjacency.keys());
  const islands: string[][] = [];
  for (const root of remaining) {
    const queue = [root];
    remaining.delete(root);
    for (let index = 0; index < queue.length; index++) {
      for (const neighbor of adjacency.get(queue[index]) ?? []) {
        if (remaining.delete(neighbor)) queue.push(neighbor);
      }
    }
    islands.push(queue);
  }
  return islands.sort((a, b) => b.length - a.length);
}

export function layoutNetwork(nodes: Node[], edges: Edge[]) {
  const width = 1120;
  const height = 760;
  if (!nodes.length) return { width, height };

  const islands = components(nodes, edges);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const mainShare = islands[0].length / nodes.length;
  const mainRadius = Math.min(300, 65 + Math.sqrt(islands[0].length) * 15);

  const points = islands.flatMap((island, islandIndex) => {
    const azimuth = islandIndex * goldenAngle;
    const orbit = islandIndex === 0 ? 0 :
      mainRadius * (mainShare > .4 ? .79 : .32) + Math.sqrt(islandIndex) * 44;
    return island.map((id, index) => {
      const node = byId.get(id)!;
      const themeAngle = node.groupIndex * goldenAngle;
      const themeBias = 57 + Math.min(40, Math.sqrt(island.length) * 3);
      const tilt = islandIndex === 0 ? themeBias : 17;
      const cx = Math.cos(azimuth) * orbit + Math.cos(themeAngle) * tilt;
      const cy = Math.sin(azimuth) * orbit * .74 + Math.sin(themeAngle) * tilt;
      const step = Math.sqrt(index) * 14;
      return {
        node, cx, cy, gravity: islandIndex === 0 ? .026 : .18,
        x: cx + Math.cos(index * goldenAngle) * step,
        y: cy + Math.sin(index * goldenAngle) * step,
      };
    });
  });
  const springs = edges.map(edge => ({
    source: edge.source_id, target: edge.target_id,
    sameTheme: byId.get(edge.source_id)?.groupIndex === byId.get(edge.target_id)?.groupIndex,
    ...edge,
  }));
  type Point = typeof points[number];
  type Spring = typeof springs[number];
  forceSimulation(points).stop()
    .force('charge', forceManyBody<Point>().strength(point => point.node.degree >= 8 ? -75 : -38).distanceMax(285))
    .force('spacing', forceCollide<Point>().radius(point => point.node.radius + 3))
    .force('naturalCenterX', forceX<Point>(point => point.cx).strength(point => point.gravity))
    .force('naturalCenterY', forceY<Point>(point => point.cy).strength(point => point.gravity))
    .force('links', forceLink<Point, Spring>(springs).id(point => point.node.id)
      .distance(edge => (edge.sameTheme ? 29 : 45) + (1 - edge.score) * 43)
      .strength(edge => (edge.sameTheme ? .34 : .29) * (edge.kind === 'tag' ? .47 : 1)))
    .tick(235);

  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const scale = Math.min(2, (width - 92) / Math.max(1, Math.max(...xs) - Math.min(...xs)),
    (height - 90) / Math.max(1, Math.max(...ys) - Math.min(...ys)));
  for (const { node, x, y } of points) {
    node.x = width / 2 + (x - midX) * scale;
    node.y = height / 2 + (y - midY) * scale;
  }
  return { width, height };
}
