import Link from 'next/link';
import { AiSignal } from './ai-signal';
export default function NotFound() {
  return <main className="app-state"><AiSignal state="connected" size={64}/><h1>还没有连接到这里。</h1><p>这个页面不存在，回到首页继续探索。</p><Link className="primary" href="/">返回首页 ↗</Link></main>;
}
