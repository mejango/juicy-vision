import { Skeleton, SkeletonLines, SkeletonTable } from '../ui/Skeleton'
import { useThemeStore } from '../../stores'

function ActivityRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-current/10" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex min-h-[72px] items-start gap-3 px-4 py-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className={index % 2 ? 'h-3 w-2/3' : 'h-3 w-4/5'} />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

function PayCardSkeleton() {
  return (
    <div className="space-y-4 p-4" aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-14 w-14 shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
      <div className="space-y-3 border border-current/10 p-3">
        <Skeleton className="h-3 w-28" />
        <div className="flex gap-2">
          <Skeleton className="h-11 flex-1" />
          <Skeleton className="h-11 w-20" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-7 w-12" />
          ))}
        </div>
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  )
}

export function RouteSkeleton() {
  const isDark = useThemeStore(state => state.theme === 'dark')
  return (
    <div
      className={`min-h-screen p-4 ${isDark ? 'bg-juice-dark text-white' : 'bg-white text-gray-900'}`}
      role="status"
      aria-label="Loading page"
    >
      <span className="sr-only">Loading page</span>
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between border-b border-current/10 py-4">
          <Skeleton className="h-16 w-24" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-9" />
          </div>
        </div>
        <div className="grid gap-5 py-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <Skeleton className="h-8 w-64 max-w-[70%]" />
            <SkeletonLines lines={4} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="border border-current/10 p-4"><SkeletonLines lines={6} /></div>
              <div className="border border-current/10 p-4"><SkeletonLines lines={6} /></div>
            </div>
          </div>
          <div className="border border-current/10">
            <ActivityRows rows={6} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function DashboardPageSkeleton({ label = 'Loading dashboard' }: { label?: string }) {
  const isDark = useThemeStore(state => state.theme === 'dark')

  return (
    <div
      className={`min-h-screen ${isDark ? 'bg-juice-dark text-white' : 'bg-gray-50 text-gray-900'}`}
      role="status"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <header className="border-b border-current/10 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4" aria-hidden="true">
          <div className="space-y-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3 w-64 max-w-[55vw]" />
          </div>
          <Skeleton className="h-9 w-24" />
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 p-6" aria-hidden="true">
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="space-y-3 border border-current/10 p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-28" />
            </div>
          ))}
        </div>
        <div className="space-y-4 border border-current/10 p-4">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-9 w-28" />
          </div>
          <SkeletonTable rows={6} columns={5} />
        </div>
      </main>
    </div>
  )
}

export function ProjectDashboardSkeleton() {
  const isDark = useThemeStore(state => state.theme === 'dark')
  return (
    <div
      className={`min-h-screen border-x-4 border-juice-orange ${isDark ? 'bg-juice-dark text-white' : 'bg-white text-gray-900'}`}
      role="status"
      aria-label="Loading project"
    >
      <span className="sr-only">Loading project</span>
      <div className="border-y-4 border-juice-orange">
        <div className="border-b border-current/10 px-4 py-5 sm:px-6">
          <Skeleton className="mb-4 h-4 w-16" />
          <div className="flex items-start gap-4">
            <Skeleton className="h-14 w-14 shrink-0 md:h-16 md:w-16" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-6 w-56 max-w-[70%]" />
              <div className="flex flex-wrap gap-3">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        </div>

        <div className="grid min-h-[620px] lg:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="border-b border-current/10 lg:border-b-0 lg:border-r">
            <PayCardSkeleton />
            <ActivityRows rows={5} />
          </aside>
          <main className="min-w-0 p-4 sm:p-6">
            <div className="flex gap-6 overflow-hidden border-b border-current/10 pb-3">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-4 w-20 shrink-0" />
              ))}
            </div>
            <div className="mt-6 space-y-5 border border-current/10 p-5">
              <Skeleton className="h-5 w-32" />
              <SkeletonLines lines={5} />
              <SkeletonTable rows={5} columns={3} className="pt-4" />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export function TabSkeleton() {
  return (
    <div className="space-y-5 border border-current/10 p-5" role="status" aria-label="Loading section">
      <span className="sr-only">Loading section</span>
      <Skeleton className="h-5 w-32" />
      <SkeletonLines lines={5} />
      <SkeletonTable rows={4} columns={3} />
    </div>
  )
}

export function ActivityFeedSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading activity">
      <span className="sr-only">Loading activity</span>
      <ActivityRows rows={rows} />
    </div>
  )
}

export function TableLoadingSkeleton({
  rows = 5,
  columns = 4,
  className = '',
  label = 'Loading table',
}: {
  rows?: number
  columns?: number
  className?: string
  label?: string
}) {
  return (
    <div className={`p-4 ${className}`} role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <SkeletonTable rows={rows} columns={columns} />
    </div>
  )
}

export function ListLoadingSkeleton({
  rows = 5,
  className = '',
  label = 'Loading list',
}: {
  rows?: number
  className?: string
  label?: string
}) {
  return (
    <div className={className} role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <ActivityRows rows={rows} />
    </div>
  )
}

export function MessageLoadingSkeleton({
  rows = 5,
  className = '',
}: {
  rows?: number
  className?: string
}) {
  return (
    <div className={`space-y-4 p-4 ${className}`} role="status" aria-label="Loading messages">
      <span className="sr-only">Loading messages</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={`flex items-start gap-3 ${index % 2 === 1 ? 'justify-end' : ''}`}
          aria-hidden="true"
        >
          {index % 2 === 0 && <Skeleton className="h-8 w-8 shrink-0 rounded-full" />}
          <div className="w-[min(72%,28rem)] space-y-2 border border-current/10 p-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          {index % 2 === 1 && <Skeleton className="h-8 w-8 shrink-0 rounded-full" />}
        </div>
      ))}
    </div>
  )
}

export function CardGridLoadingSkeleton({
  cards = 6,
  className = '',
  label = 'Loading cards',
}: {
  cards?: number
  className?: string
  label?: string
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 ${className}`}
      role="status"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} className="h-28 space-y-3 border border-current/10 p-4" aria-hidden="true">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-3 w-5/6" />
        </div>
      ))}
    </div>
  )
}

export function PaymentPageSkeleton() {
  const isDark = useThemeStore(state => state.theme === 'dark')

  return (
    <div
      className={`flex min-h-screen items-center justify-center p-4 ${isDark ? 'bg-juice-dark text-white' : 'bg-gray-50 text-gray-900'}`}
      role="status"
      aria-label="Loading payment"
    >
      <span className="sr-only">Loading payment</span>
      <div className="w-full max-w-sm space-y-5 border border-current/10 p-6">
        <div className="flex items-center gap-3" aria-hidden="true">
          <Skeleton className="h-12 w-12 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <div className="space-y-3 border-y border-current/10 py-4" aria-hidden="true">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  )
}

export function ModalLoadingSkeleton({ label = 'Loading dialog' }: { label?: string }) {
  const isDark = useThemeStore(state => state.theme === 'dark')

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="status"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className={`relative w-full max-w-md space-y-5 border p-5 ${
          isDark
            ? 'border-white/10 bg-juice-dark-lighter text-white'
            : 'border-gray-200 bg-white text-gray-900'
        }`}
        aria-hidden="true"
      >
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-8 w-8" />
        </div>
        <SkeletonLines lines={4} />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  )
}

export function SidePanelLoadingSkeleton({ label = 'Loading panel' }: { label?: string }) {
  const isDark = useThemeStore(state => state.theme === 'dark')

  return (
    <div
      className={`fixed inset-y-0 right-0 z-[150] w-full max-w-sm border-l shadow-xl ${
        isDark
          ? 'border-white/10 bg-juice-dark text-white'
          : 'border-gray-200 bg-white text-gray-900'
      }`}
      role="status"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <div className="flex items-center justify-between border-b border-current/10 p-4" aria-hidden="true">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-8" />
      </div>
      <ActivityRows rows={6} />
    </div>
  )
}
