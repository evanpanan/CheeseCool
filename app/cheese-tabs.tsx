import Link from 'next/link';

export type CheeseMode = 'capture' | 'library';

export function CheeseTabs({ active }: { active?: CheeseMode }) {
  return <nav className="cheese-tabs" aria-label="使用模式">
    <Link href="/" aria-current={active === 'capture' ? 'page' : undefined}>收藏</Link>
    <Link href="/network" aria-current={active === 'library' ? 'page' : undefined}>芝士库</Link>
  </nav>;
}
