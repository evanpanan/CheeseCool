'use client';

import { useRef, useState } from 'react';
import { Icon } from './icons';

export function CollectionSearch({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const input = useRef<HTMLInputElement>(null);
  return <form action="/" className="search" role="search">
    <input type="hidden" name="view" value="list"/>
    <Icon name="search" size={18}/>
    <input ref={input} aria-label="搜索芝士库" autoComplete="off" type="search" name="q" maxLength={240}
      value={query} onChange={event => setQuery(event.target.value)} enterKeyHint="search"
      placeholder="找一条收藏，或一个想法"/>
    {query && <button type="button" className="search-clear" aria-label="清空搜索内容"
      onClick={() => { setQuery(''); input.current?.focus(); }}><Icon name="close" size={15}/></button>}
    <button type="submit" className="search-submit">搜索</button>
  </form>;
}
