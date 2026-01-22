import { useThemeStore } from '../../stores'

/**
 * A ghost/skeleton loading state for the OptionsPicker component.
 * Mimics the layout with animated placeholder elements.
 */
export default function OptionsPickerShimmer() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const shimmerBg = isDark ? 'bg-white/10' : 'bg-gray-200'
  const shimmerBgLight = isDark ? 'bg-white/5' : 'bg-gray-100'

  return (
    <div className={`border overflow-hidden inline-block max-w-lg w-full ${
      isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
    }`}>
      <div className="p-4 space-y-4">
        {/* Header label skeleton */}
        <div className={`h-3 w-24 rounded ${shimmerBg} animate-pulse`} />

        {/* Radio option skeletons */}
        <div className="space-y-2">
          {[
            { titleWidth: '55%', subWidth: '70%' },
            { titleWidth: '45%', subWidth: '80%' },
            { titleWidth: '60%', subWidth: '65%' },
            { titleWidth: '50%', subWidth: '75%' },
          ].map((widths, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 px-3 py-2 border ${
                isDark ? 'border-white/10' : 'border-gray-200'
              } ${shimmerBgLight}`}
            >
              {/* Radio circle */}
              <div className={`w-5 h-5 mt-0.5 rounded-full border-2 shrink-0 ${
                isDark ? 'border-gray-600' : 'border-gray-300'
              }`} />
              {/* Text content */}
              <div className="flex flex-col gap-1.5 flex-1">
                <div
                  className={`h-4 rounded ${shimmerBg} animate-pulse`}
                  style={{
                    width: widths.titleWidth,
                    animationDelay: `${i * 100}ms`
                  }}
                />
                <div
                  className={`h-3 rounded ${shimmerBg} animate-pulse opacity-60`}
                  style={{
                    width: widths.subWidth,
                    animationDelay: `${i * 100 + 50}ms`
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer skeleton */}
      <div className={`px-4 py-3 border-t flex items-center gap-3 ${
        isDark ? 'border-white/10' : 'border-gray-100'
      }`}>
        <div className={`flex-1 h-4 rounded ${shimmerBg} animate-pulse opacity-40`} />
        <div className={`h-8 w-24 rounded ${shimmerBg} animate-pulse`} />
      </div>
    </div>
  )
}
