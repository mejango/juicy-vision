import type { HTMLAttributes } from 'react'

export function Skeleton({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const ariaHidden = props['aria-hidden'] ?? (props.role ? undefined : true)

  return (
    <div
      {...props}
      aria-hidden={ariaHidden}
      className={`skeleton-shimmer ${className}`}
    />
  )
}

export function SkeletonLines({
  lines = 3,
  className = '',
}: {
  lines?: number
  className?: string
}) {
  const widths = ['w-full', 'w-5/6', 'w-2/3', 'w-3/4']
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={`h-3 ${widths[index % widths.length]}`}
        />
      ))}
    </div>
  )
}

export function SkeletonTable({
  rows = 4,
  columns = 4,
  className = '',
}: {
  rows?: number
  columns?: number
  className?: string
}) {
  return (
    <div className={`space-y-4 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="grid items-center gap-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton
              key={column}
              className={`h-3 ${column === 0 ? 'w-3/4' : 'w-2/3'}`}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export type ChartSkeletonVariant = 'line' | 'bar' | 'pie'

export function ChartSkeleton({
  className = '',
  variant = 'line',
}: {
  className?: string
  variant?: ChartSkeletonVariant
}) {
  const hasAxes = variant !== 'pie'

  return (
    <div
      className={`relative overflow-hidden ${hasAxes ? 'border-b border-l border-current/10' : ''} ${className}`}
      role="status"
      aria-label="Loading chart"
    >
      <span className="sr-only">Loading chart</span>
      {hasAxes && (
        <div className="absolute inset-0 flex flex-col justify-evenly px-4 opacity-40" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="border-t border-current/10" />
          ))}
        </div>
      )}
      {variant === 'line' && (
        <div className="absolute inset-x-4 bottom-3 top-4 opacity-20" aria-hidden="true">
          <svg className="h-full w-full" viewBox="0 0 1000 300" preserveAspectRatio="none">
            <path
              d="M 20 268 H 100 V 248 H 185 V 225 H 270 V 196 H 360 V 166 H 450 V 130 H 545 V 98 H 635 V 72 H 725 V 54 H 815 V 39 H 900 V 25 H 980"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              strokeLinecap="square"
              strokeLinejoin="miter"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M 20 278 H 980"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="square"
              vectorEffect="non-scaling-stroke"
              opacity="0.7"
            />
          </svg>
        </div>
      )}
      {variant === 'bar' && (
        <div className="absolute inset-x-4 bottom-3 top-4 flex items-end gap-2 opacity-20" aria-hidden="true">
          {[28, 38, 34, 52, 46, 62, 58, 74, 68, 82, 72, 64].map((height, index) => (
            <Skeleton
              key={index}
              className="min-w-0 flex-1"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      )}
      {variant === 'pie' && (
        <div className="absolute inset-0 flex items-center justify-center gap-8 px-5" aria-hidden="true">
          <svg className="h-40 w-40 shrink-0 opacity-20" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="34"
              fill="none"
              stroke="currentColor"
              strokeWidth="20"
            />
          </svg>
          <div className="hidden w-28 space-y-3 sm:block">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 shrink-0" />
                <Skeleton className="h-3 flex-1" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
