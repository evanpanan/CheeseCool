type IconName = 'plus' | 'search' | 'archive' | 'arrow' | 'close' | 'lock' | 'logout' | 'link';

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14"/>,
    search: <><circle cx="10.8" cy="10.8" r="5.8"/><path d="m15.2 15.2 4.2 4.2"/></>,
    archive: <><rect x="4" y="4" width="16" height="4" rx="1"/><path d="M5.5 8v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8M10 12h4"/></>,
    arrow: <path d="M6 18 18 6M9 6h9v9"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/></>,
    logout: <path d="M10 5H5v14h5m3-10 4 3-4 3m-4-3h10"/>,
    link: <path d="m10 13 4-4m-6 7-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m2 2a3 3 0 0 0 4 0l4-4a3 3 0 0 0-4-4l-1 1"/>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function CheeseMark({ size = 32 }: { size?: number }) {
  return <img src="/cheesecool-logo.svg" alt="" width={size} height={size}/>;
}

export function Brand() {
  return <span className="brand">
    <CheeseMark/>
    <span>Cheese<span className="brand-accent">Cool</span></span>
  </span>;
}
