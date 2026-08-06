import { useThemeStore } from '../../stores'
import {
  getProjectNavigationHint,
  type ProjectNavigationHint,
} from '../../utils/projectNavigationCache'
import { IpfsImage } from '../ui/IpfsMedia'

export default function ProjectRouteLoading({
  chainId,
  projectId,
  hint = getProjectNavigationHint(chainId, projectId),
}: {
  chainId: number
  projectId: number
  hint?: ProjectNavigationHint | null
}) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const ghost = isDark ? 'bg-white/10' : 'bg-gray-200'

  return (
    <div className={`min-h-screen border-4 border-juice-orange ${isDark ? 'bg-juice-dark' : 'bg-white'}`}>
      <div className={`border-b px-4 py-5 sm:px-6 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className="mb-4 text-sm text-gray-500">Back</div>
        <div className="flex items-start gap-4" aria-busy="true">
          {hint ? (
            <div className="stale-loading shrink-0">
              <IpfsImage
                uri={hint.logoUri}
                alt=""
                className="h-16 w-16 object-cover"
                fallback={
                  <div className={`flex h-16 w-16 items-center justify-center text-2xl ${ghost}`}>
                    {hint.name.slice(0, 1).toUpperCase()}
                  </div>
                }
              />
            </div>
          ) : (
            <div className={`h-16 w-16 shrink-0 component-shimmer ${ghost}`} />
          )}
          <div className="min-w-0 flex-1">
            {hint ? (
              <>
                <h1 className={`stale-loading w-fit max-w-full truncate text-xl font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {hint.name}
                </h1>
                {hint.tagline ? (
                  <p className={`stale-loading mt-1 w-fit max-w-full text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    {hint.tagline}
                  </p>
                ) : null}
              </>
            ) : (
              <p className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Project #{projectId}
              </p>
            )}
            <div className="mt-3 flex gap-3">
              <div className={`h-4 w-28 component-shimmer ${ghost}`} />
              <div className={`h-4 w-20 component-shimmer ${ghost}`} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className={`h-72 component-shimmer ${ghost}`} aria-hidden="true" />
        <div className="space-y-5" aria-hidden="true">
          <div className="flex gap-3">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className={`h-9 w-24 component-shimmer ${ghost}`} />
            ))}
          </div>
          <div className={`h-56 component-shimmer ${ghost}`} />
          <div className={`h-32 component-shimmer ${ghost}`} />
        </div>
      </div>
      <span className="sr-only">Loading project details</span>
    </div>
  )
}
