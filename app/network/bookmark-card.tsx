import Link from 'next/link';
import { platformNames, type Platform } from '@/lib/urls';
import { Retry } from '../controls';
import { Icon } from '../icons';
import { AiSignal } from '../ai-signal';

export type Bookmark = {
  id: string; original_url: string; final_url: string | null; title: string;
  platform: Platform; cover_url: string | null; summary: string;
  ai_summary: string | null; tags: string[]; status: string; created_at: string;
};

export function BookmarkCard({ item, related, ai, canIndex }: { item: Bookmark; related: Bookmark[]; ai: boolean; canIndex: boolean }) {
  return <article id={item.id} className="bookmark">
    {item.cover_url && <div className="cover" style={{ backgroundImage: `url(${JSON.stringify(item.cover_url)})` }}/>}
    <div className="bookmark-body">
      <span className="platform"><Icon name="link" size={14}/> {platformNames[item.platform]}</span>
      <h3><a href={item.final_url || item.original_url} target="_blank" rel="noopener noreferrer">{item.title}<Icon name="arrow" size={17}/></a></h3>
      {(item.ai_summary || item.summary) && <div className="summary-label"><AiSignal state="connected" size={15}/>{item.ai_summary?'AI 摘要':'网页摘要'}</div>}
      {(item.ai_summary || item.summary) && <p>{item.ai_summary || item.summary}</p>}
      {!!item.tags.length && <ul aria-label="标签" className="tags">{item.tags.map(tag => <li key={tag}><Link href={'/?view=list&q=' + encodeURIComponent(tag)}>{tag}</Link></li>)}</ul>}
      {item.status !== 'indexed' && <div className="status-row">
        <span>{item.status === 'limited' ? '链接已存好，正文暂时无法读取' : item.status === 'extracted' ? (item.ai_summary ? (canIndex ? '摘要已就绪，关联待整理' : '已自动整理') : ai ? '摘要和标签待整理' : '已提取内容') : '链接已存好，内容待整理'}</span>
        {(item.status !== 'extracted' || (item.ai_summary ? canIndex : ai)) && <Retry id={item.id}/>}
      </div>}
      {!!related.length && <details>
        <summary>相关收藏 <span>{related.length}</span><Icon name="chevron" size={15}/></summary>
        <ul>{related.map(other => <li key={other.id}>
          <a href={other.final_url || other.original_url} target="_blank" rel="noopener noreferrer">{other.title}</a>
        </li>)}</ul>
      </details>}
    </div>
  </article>;
}
