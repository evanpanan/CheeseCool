import { CheeseMark } from './icons';
export function BrandLoader({complete=false}:{complete?:boolean}) {
  return <span className="brand-loader" data-complete={complete || undefined} aria-hidden="true">
    <CheeseMark size={72}/>
    {complete && <span className="brand-loader-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 4 4L19 6"/></svg></span>}
  </span>;
}
