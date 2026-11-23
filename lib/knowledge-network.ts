import type { Platform } from './urls';
import { layoutNetwork } from './network-layout';

export type NetworkBookmark = {
  id: string;
  title: string;
  original_url: string;
  final_url: string | null;
  platform: Platform;
  summary: string;
  ai_summary: string | null;
  tags: string[];
  status: string;
  record_type?: string;
  attributes?: Record<string, unknown>;
};

export type NetworkEdge = { source_id: string; target_id: string; score: number; kind?: 'tag' };

const palette = ['#7761d8', '#168f97', '#3682ce', '#cf8b35', '#b362a7', '#cc6c85', '#6f9c42'];
const ungrouped = 'untagged';

export function buildNetwork(bookmarks: NetworkBookmark[], edges: NetworkEdge[], portrait = false) {
  const ids = new Set(bookmarks.map(bookmark => bookmark.id));
  const links = edges.filter(edge => ids.has(edge.source_id) && ids.has(edge.target_id));
  const tagNames = new Map<string, string>();
  const tagCounts = new Map<string, number>();
  const tagsById = new Map(bookmarks.map(bookmark => {
    const tags = [...new Set(bookmark.tags.map(tag => {
      const label = tag.trim();
      const key = 'tag:' + label.normalize('NFKC').toLowerCase();
      if (label && !tagNames.has(key)) tagNames.set(key, label);
      return key;
    }).filter(key => key !== 'tag:'))];
    for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    return [bookmark.id, tags];
  }));

  const existing = new Set(links.map(edge => [edge.source_id, edge.target_id].sort().join(':')));
  const addedPerNode = new Map<string, number>();
  for (const item of bookmarks) {
    const tags = tagsById.get(item.id) ?? [];
    if (!tags.length) continue;
    const candidates = bookmarks.flatMap(candidate => {
      if (item.id === candidate.id) return [];
      const other = tagsById.get(candidate.id) ?? [];
      const shared = tags.filter(tag => other.includes(tag));
      if (!shared.length) return [];
      const score = shared.reduce((sum, tag) => sum + 1 / Math.sqrt(tagCounts.get(tag) ?? 1), 0);
      return [{ id: candidate.id, score }];
    }).sort((a, b) => b.score - a.score);
    for (const candidate of candidates) {
      if ((addedPerNode.get(item.id) ?? 0) >= 2) break;
      if ((addedPerNode.get(candidate.id) ?? 0) >= 2) continue;
      const pair = [item.id, candidate.id].sort().join(':');
      if (existing.has(pair)) continue;
      existing.add(pair);
      addedPerNode.set(item.id, (addedPerNode.get(item.id) ?? 0) + 1);
      addedPerNode.set(candidate.id, (addedPerNode.get(candidate.id) ?? 0) + 1);
      links.push({ source_id: item.id, target_id: candidate.id, score: .43, kind: 'tag' });
    }
  }

  const neighbors = new Map<string, { id: string; score: number; kind?: 'tag' }[]>();
  for (const { source_id, target_id, score, kind } of links) {
    for (const [id, other] of [[source_id, target_id], [target_id, source_id]]) {
      const adjacent = neighbors.get(id) ?? [];
      adjacent.push({ id: other, score, kind });
      neighbors.set(id, adjacent);
    }
  }
  for (const adjacent of neighbors.values()) adjacent.sort((a, b) => b.score - a.score);

  const grouped = new Map<string, NetworkBookmark[]>();
  for (const bookmark of bookmarks) {
    const tags = tagsById.get(bookmark.id) ?? [];
    // Prefer tags shared by this bookmark's neighbors, then tags shared across the library.
    const adjacentTags = new Map<string, number>();
    for (const neighbor of neighbors.get(bookmark.id) ?? []) {
      for (const tag of tagsById.get(neighbor.id) ?? []) {
        adjacentTags.set(tag, (adjacentTags.get(tag) ?? 0) + neighbor.score);
      }
    }
    const [key = ungrouped] = tags.sort((a, b) =>
      (adjacentTags.get(b) ?? 0) - (adjacentTags.get(a) ?? 0) ||
      (tagCounts.get(b) ?? 0) - (tagCounts.get(a) ?? 0));
    const group = grouped.get(key) ?? [];
    group.push(bookmark);
    grouped.set(key, group);
  }

  const groups = [...grouped].sort(([a, left], [b, right]) =>
    Number(a === ungrouped) - Number(b === ungrouped) ||
    right.length - left.length || a.localeCompare(b, 'zh-CN'));
  const positioned = groups.map(([key, items], groupIndex) => {
    const color = key === ungrouped ? '#58646f' : palette[groupIndex % palette.length];
    const nodes = items.map(bookmark => {
      const connections = neighbors.get(bookmark.id) ?? [];
      return {
        ...bookmark, group: key, groupIndex, color, connections, degree: connections.length,
        x: 0, y: 0, radius: 7 + Math.min(10, Math.sqrt(connections.length) * 2.4),
      };
    }).sort((a, b) => b.degree - a.degree);
    return { key, label: tagNames.get(key) ?? '未分类', color, size: nodes.length, nodes };
  });
  const nodes = positioned.flatMap(group => group.nodes);
  const bounds = layoutNetwork(nodes, links, portrait);
  const groupsWithBounds = positioned.map(group => {
    const departures = group.nodes.map(node => node.x);
    const heights = group.nodes.map(node => node.y);
    return {
      ...group,
      x: (Math.min(...departures) + Math.max(...departures)) / 2,
      y: (Math.min(...heights) + Math.max(...heights)) / 2,
      top: Math.min(...heights),
      span: Math.max(Math.max(...departures) - Math.min(...departures), Math.max(...heights) - Math.min(...heights)) + 94,
    };
  });
  return { ...bounds, groups: groupsWithBounds, nodes, links };
}
