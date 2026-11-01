import type { CSSProperties } from 'react';

export function Skeleton({
  width = '100%',
  height = '1rem',
  style,
}: {
  width?: string;
  height?: string;
  style?: CSSProperties;
}) {
  return <span className="skeleton" aria-hidden="true" style={{ width, height, ...style }} />;
}

/** A table-shaped placeholder: same row rhythm as the real thing, so the page does not jump when data arrives. */
export function SkeletonRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="stack" style={{ gap: '.9rem' }}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="row" style={{ flexWrap: 'nowrap' }}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} width={c === 0 ? '34%' : `${Math.max(12, 30 - c * 5)}%`} height="1.1rem" />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card flat stack" style={{ gap: '.6rem' }}>
          <Skeleton width="45%" height=".8rem" />
          <Skeleton width="70%" height="1.8rem" />
        </div>
      ))}
    </div>
  );
}
