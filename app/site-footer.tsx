import { Icon } from './icons';

const author = {
  name: 'Cooper',
  handle: '@Yep_Cooper',
  url: 'https://x.com/Yep_Cooper',
  avatar: '/cooper-avatar.webp',
};

export function SiteFooter() {
  return <footer className="site-footer">
    <div className="frame footer-inner">
      <span className="footer-brand">CheeseCool</span>
      <a className="author-link" href={author.url} target="_blank" rel="noopener noreferrer"
        aria-label={`网站作者 ${author.name}，在 X 查看 ${author.handle}`}>
        <img src={author.avatar} width={32} height={32} alt="" loading="lazy" decoding="async"/>
        <span className="author-identity">
          <strong>{author.name}</strong>
          <span>作者 · {author.handle}</span>
        </span>
        <span className="author-external" aria-hidden="true"><Icon name="arrow" size={15}/></span>
      </a>
    </div>
  </footer>;
}
