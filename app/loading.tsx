import { AiSignal } from './ai-signal';
export default function Loading() {
  return <main className="app-state" role="status"><AiSignal state="thinking" size={58}/><p>正在加载你的空间…</p></main>;
}
