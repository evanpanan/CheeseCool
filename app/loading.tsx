import { BrandLoader } from './brand-loader';
export default function Loading() {
  return <main className="app-state" role="status"><BrandLoader/><p>正在加载你的空间…</p></main>;
}
