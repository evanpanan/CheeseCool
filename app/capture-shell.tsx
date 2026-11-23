'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { AccountMenuProps } from './account-menu';
import { WorkspaceInput } from './workspace-input';
import { WorkspaceHeader } from './workspace-header';
import { WorkspaceActivity, type WorkspaceSearch } from './workspace-activity';
import type { WorkspaceResult } from './actions';

export function CaptureShell({ account, children }: { account: AccountMenuProps; children: ReactNode }) {
  const router = useRouter();
  const sequence = useRef(0);
  const [composing, setComposing] = useState(false);
  const [savedBookmark, setSavedBookmark] = useState<{ id: string; event: number } | null>(null);
  const [search, setSearch] = useState<WorkspaceSearch | null>(null);
  const clearSearch = useCallback(() => setSearch(null), []);
  const onResult = useCallback((result: WorkspaceResult) => {
    if (result.kind === 'search') {
      setSearch({ query: result.query!, bookmarks: result.bookmarks ?? [], edges: result.edges ?? [] });
    } else if (result.id) {
      setSearch(null);
      setSavedBookmark({ id: result.id, event: ++sequence.current });
      router.refresh();
    }
  }, [router]);

  return <WorkspaceActivity value={{ composing, savedBookmark, search, clearSearch }}>
    <WorkspaceHeader account={account} workspace/>
    <main className="cheese-workspace capture-page" data-view="graph">
      <div className="workspace-composer" onFocusCapture={() => setComposing(true)}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setComposing(false);
        }}>
        <WorkspaceInput onResult={onResult}/>
      </div>
      <div className="workspace-content">{children}</div>
    </main>
  </WorkspaceActivity>;
}
