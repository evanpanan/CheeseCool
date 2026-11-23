'use client';

import { createContext, useContext } from 'react';
import type { NetworkBookmark, NetworkEdge } from '@/lib/knowledge-network';

export type WorkspaceSearch = { query: string; bookmarks: NetworkBookmark[]; edges: NetworkEdge[] };
export const WorkspaceActivity = createContext<{
  composing: boolean;
  savedBookmark: { id: string; event: number } | null;
  search: WorkspaceSearch | null;
  clearSearch: () => void;
}>({ composing: false, savedBookmark: null, search: null, clearSearch: () => {} });

export const useWorkspaceActivity = () => useContext(WorkspaceActivity);
