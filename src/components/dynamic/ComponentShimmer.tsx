import { useThemeStore } from '../../stores'

/**
 * A subtle loading indicator shown while a component is being streamed.
 * Three small dots that pulse gently - minimal and unobtrusive.
 */
export default function ComponentShimmer() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const dotColor = isDark ? 'bg-white/20' : 'bg-gray-300'

  return (
    <div className="flex items-center gap-1 py-2">
      <div
        className={`w-1.5 h-1.5 rounded-full ${dotColor} animate-pulse`}
        style={{ animationDelay: '0ms' }}
      />
      <div
        className={`w-1.5 h-1.5 rounded-full ${dotColor} animate-pulse`}
        style={{ animationDelay: '150ms' }}
      />
      <div
        className={`w-1.5 h-1.5 rounded-full ${dotColor} animate-pulse`}
        style={{ animationDelay: '300ms' }}
      />
    </div>
  )
}
