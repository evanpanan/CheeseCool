import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';

type Node = { id: string; groupIndex: number; degree: number; radius: number; x: number; y: number };
type Edge = { source_id: string; target_id: string; score: number; kind?: 'tag' };
const goldenAngle = Math.PI * (3 - Math.sqrt(5));

export function layoutNetwork(nodes: Node[], edges: Edge[], portrait = false) {
  const width = portrait ? 760 : 1120;
  const height = portrait ? 1340 : 760;
  if (!nodes.length) return { width, height };

  const groups = [...new Set(nodes.map(node => node.groupIndex))];
  const groupCenters = new Map(groups.map((key, index) => {
    const angle = index * goldenAngle - Math.PI / 2;
    const orbit = index === 0 ? 0 : 190 + Math.sqrt(index) * 42;
    return [key, {
      x: Math.cos(angle) * orbit * (portrait ? .72 : 1.25),
      y: Math.sin(angle) * orbit * (portrait ? 1.7 : .84),
    }];
  }));
  const groupCounts = new Map<number, number>();
  const points = nodes.map(node => {
    const center = groupCenters.get(node.groupIndex)!;
    const index = groupCounts.get(node.groupIndex) ?? 0;
    groupCounts.set(node.groupIndex, index + 1);
    const radius = Math.sqrt(index) * 58;
    return { node, cx: center.x, cy: center.y,
      x: center.x + Math.cos(index * goldenAngle) * radius,
      y: center.y + Math.sin(index * goldenAngle) * radius };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  const springs = edges.map(edge => ({
    source: edge.source_id, target: edge.target_id,
    sameTheme: byId.get(edge.source_id)?.groupIndex === byId.get(edge.target_id)?.groupIndex,
    ...edge,
  }));
  type Point = typeof points[number];
  type Spring = typeof springs[number];
  forceSimulation(points).stop()
    .force('charge', forceManyBody<Point>().strength(-235).distanceMax(360))
    .force('spacing', forceCollide<Point>().radius(point => point.node.radius + (portrait ? 31 : 28)))
    .force('themeX', forceX<Point>(point => point.cx).strength(groups.length === 1 ? .035 : .19))
    .force('themeY', forceY<Point>(point => point.cy).strength(groups.length === 1 ? .035 : .19))
    .force('links', forceLink<Point, Spring>(springs).id(point => point.node.id)
      .distance(edge => (edge.sameTheme ? 112 : 230) + (1 - edge.score) * 40)
      .strength(edge => edge.sameTheme ? .18 : .055))
    .tick(250);

  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const scale = Math.min(1.6, (width - 180) / Math.max(1, Math.max(...xs) - Math.min(...xs)),
    (height - 210) / Math.max(1, Math.max(...ys) - Math.min(...ys)));
  for (const { node, x, y } of points) {
    node.x = width / 2 + (x - midX) * scale;
    node.y = height / 2 + (y - midY) * scale;
  }
  return { width, height };
}
