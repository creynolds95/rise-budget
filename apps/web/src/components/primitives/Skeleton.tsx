/** Loading blocks shaped like what they stand in for (§8). No spinners on full screens. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden className={`block animate-pulse rounded-input bg-hairline ${className}`} />
  );
}
