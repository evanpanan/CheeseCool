type Props = {
  color: string;
  detailed?: boolean;
  size?: number;
  className?: string;
};

export function CheeseSlice({ color, detailed, size = 1, className }: Props) {
  return <g className={className} transform={`scale(${size})`} style={{ color }}>
    <path className="slice-face" d="M-9 0.5Q-9-1-7.4-2L1.5-7.3Q3-8.1 4.7-7.1L8-5Q9.4-4.1 9.4-2.2V5.1Q9.4 7 7.5 7H-7Q-9 7-9 5Z"/>
    {detailed && <>
      <path className="slice-top" d="M-8.6-0.7-7.4-2 1.5-7.3Q3-8.1 4.7-7.1L8-5 8.9-4.3Z"/>
      <circle className="slice-hole" cx="-4.8" cy="3" r="1.45"/>
      <circle className="slice-hole" cx="1.6" cy=".6" r="1.35"/>
      <circle className="slice-hole" cx="5.8" cy="3.8" r="1.25"/>
    </>}
  </g>;
}

export function CheeseBadge({ color }: { color: string }) {
  return <svg className="atlas-cheese-badge" width="24" height="23" viewBox="-12 -12 24 24" aria-hidden="true">
    <CheeseSlice color={color} detailed/>
  </svg>;
}
