import { AddBookmark } from './controls';
import { CheeseMark, Icon } from './icons';
import { WorkspaceHeader } from './workspace-header';

export function LibraryShell({ query, children }: { query: string; children: React.ReactNode }) {
  return <>
    <WorkspaceHeader active="library"/>
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-content">
          <div className="hero-mark"><CheeseMark size={82}/></div>
          <h1 id="hero-title" lang="en">Save the <em>cool</em> stuff.</h1>
          <p className="hero-slogan">把好东西都存起来。</p>
          <div className="hero-description">
            <p lang="en">Your AI-powered second brain.</p>
            <p>你的 AI 智能收藏与芝士网络。</p>
          </div>
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
  return <div className="empty">
    <span className="empty-icon">
      {query ? <Icon name="search" size={23}/> : <CheeseMark size={34}/>}
    </span>
    <h3>{query ? '没有找到相关收藏' : page > 1 ? '这一页没有收藏' : '等待第一条好东西'}</h3>
    <p>{query ? '试试其他描述或关键词。' : page > 1 ? '可以返回上一页。' : '把想留住的链接粘贴到上方输入框。'}</p>
  </div>;
}
