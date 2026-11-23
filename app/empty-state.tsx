import Link from 'next/link';
import { CheeseMark, Icon } from './icons';

export function EmptyState({ title, description, href, action }: {
  title: string; description: string; href: string; action: string;
}) {
  return <div className="empty collection-empty">
    <span className="empty-cheese"><CheeseMark size={42}/></span>
    <h2>{title}</h2>
    <p>{description}</p>
    <Link className="quiet-action" href={href}>{action}<Icon name="arrow" size={16}/></Link>
  </div>;
}
