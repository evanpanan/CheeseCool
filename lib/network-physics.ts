import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';

export type PhysicsNode = SimulationNodeDatum & { id: string; x: number; y: number; homeX: number; homeY: number; radius: number };
export type PhysicsLink = { source: string | PhysicsNode; target: string | PhysicsNode };

// Use copies: D3 mutates positions and resolves link IDs to node objects.
export function createNetworkPhysics(input: { id: string; x: number; y: number; radius: number }[], edges: { source: string; target: string }[], charge = -450, distance = 140) {
  const nodes: PhysicsNode[] = input.map(node => ({ ...node, homeX: node.x, homeY: node.y }));
  const ids = new Set(nodes.map(node => node.id));
  const links: PhysicsLink[] = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map(edge => ({ ...edge }));
  const simulation = forceSimulation(nodes).stop()
    .force('link', forceLink<PhysicsNode, PhysicsLink>(links).id(node => node.id).distance(distance).strength(.18))
    .force('charge', forceManyBody<PhysicsNode>().strength(charge).distanceMax(520))
    .force('collide', forceCollide<PhysicsNode>().radius(node => node.radius + 22).iterations(2))
    .force('homeX', forceX<PhysicsNode>(node => node.homeX).strength(.045))
    .force('homeY', forceY<PhysicsNode>(node => node.homeY).strength(.045))
    .velocityDecay(.38).alpha(.7);
  return { simulation, nodes, links };
}
