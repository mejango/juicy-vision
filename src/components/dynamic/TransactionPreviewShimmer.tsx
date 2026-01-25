import { useThemeStore } from '../../stores'

/**
 * A ghost/skeleton loading state for the TransactionPreview component.
 * Mimics the card layout with header, explanation, and expandable sections.
 */
export default function TransactionPreviewShimmer() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const shimmerBg = isDark ? 'bg-white/10' : 'bg-gray-200'
  const shimmerBgLight = isDark ? 'bg-white/5' : 'bg-gray-100'

  return (
    <div className={`border overflow-hidden max-w-2xl w-full ${
      isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
    }`}>
      {/* Header with icon, title, and chain chips */}
      <div className={`px-4 py-3 border-b ${
        isDark ? 'border-white/10' : 'border-gray-200'
      }`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {/* Icon placeholder */}
            <div className={`w-6 h-6 rounded ${shimmerBg} animate-pulse`} />
            {/* Title placeholder */}
            <div className={`h-5 w-40 rounded ${shimmerBg} animate-pulse`} style={{ animationDelay: '50ms' }} />
          </div>
          {/* Chain chips placeholder */}
          <div className="flex gap-2">
            <div className={`h-6 w-20 rounded ${shimmerBg} animate-pulse`} style={{ animationDelay: '100ms' }} />
            <div className={`h-6 w-16 rounded ${shimmerBg} animate-pulse`} style={{ animationDelay: '150ms' }} />
          </div>
        </div>
      </div>

      {/* Explanation area */}
      <div className="px-4 py-3 space-y-2">
        <div className={`h-4 w-full rounded ${shimmerBg} animate-pulse`} style={{ animationDelay: '200ms' }} />
        <div className={`h-4 w-3/4 rounded ${shimmerBg} animate-pulse`} style={{ animationDelay: '250ms' }} />
      </div>

      {/* Expandable section header */}
      <div className={`px-4 py-2 border-t ${
        isDark ? 'border-white/10' : 'border-gray-200'
      }`}>
        <div className="flex items-center gap-2">
          <div className={`w-4 h-4 rounded ${shimmerBgLight} animate-pulse`} />
          <div className={`h-3 w-32 rounded ${shimmerBg} animate-pulse opacity-60`} style={{ animationDelay: '300ms' }} />
        </div>
      </div>

      {/* Technical details skeleton (collapsed state preview) */}
      <div className={`px-4 py-3 space-y-3 ${shimmerBgLight}`}>
        {/* Row placeholders */}
        {[
          { labelWidth: '20%', valueWidth: '35%' },
          { labelWidth: '15%', valueWidth: '45%' },
          { labelWidth: '25%', valueWidth: '30%' },
        ].map((widths, i) => (
          <div key={i} className="flex justify-between items-center">
            <div
              className={`h-3 rounded ${shimmerBg} animate-pulse opacity-60`}
              style={{ width: widths.labelWidth, animationDelay: `${350 + i * 50}ms` }}
            />
            <div
              className={`h-3 rounded ${shimmerBg} animate-pulse`}
              style={{ width: widths.valueWidth, animationDelay: `${375 + i * 50}ms` }}
            />
          </div>
        ))}
      </div>

      {/* Action button area */}
      <div className={`px-4 py-3 border-t ${
        isDark ? 'border-white/10' : 'border-gray-200'
      }`}>
        <div className={`h-10 w-full rounded ${shimmerBg} animate-pulse`} style={{ animationDelay: '500ms' }} />
      </div>
    </div>
  )
}
