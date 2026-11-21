import { AddBookmark } from './controls';
import { CheeseMark, Icon } from './icons';
import { WorkspaceHeader } from './workspace-header';

export function LibraryShell({ query, children }: { query: string; children: React.ReactNode }) {
  return <>
    <WorkspaceHeader active="library"/>
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <div className="frame hero-content">
          <div className="hero-mark"><CheeseMark size={46}/></div>
          <h1 id="hero-title" lang="en">Save the cool stuff.</h1>
          <p className="hero-slogan">把好东西都存起来。</p>
          <AddBookmark/>
        </div>
      </section>
      <section className="frame library" aria-labelledby="library-title">
        <div className="library-heading">
          <h2 id="library-title">{query ? '搜索结果' : '最近收藏'}</h2>
          <form action="/" className="search" role="search">
            <Icon name="search" size={18}/>
            <input aria-label="搜索收藏" autoComplete="off" type="search" name="q" maxLength={240}
              key={query} defaultValue={query} placeholder="用关键词或一句话搜索"/>
            <button type="submit">搜索</button>
          </form>
        </div>
        {children}
      </section>
    </main>
  </>;
}

export function LibraryEmpty({ query, page }: { query: string; page: number }) {
  return <p className="library-empty">
    {query ? '没有找到匹配的收藏。' : page > 1 ? '这一页没有收藏。' : '还没有收藏。粘贴一个链接开始。'}
  </p>;
}
