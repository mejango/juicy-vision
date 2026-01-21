import { Component, ReactNode } from 'react'
import { useThemeStore } from '../../stores'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

class ErrorBoundaryClass extends Component<Props & { isDark: boolean }, State> {
  constructor(props: Props & { isDark: boolean }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      const { isDark } = this.props
      return (
        <div className={`flex flex-col items-center justify-center p-8 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          <div className={`p-6 max-w-md text-center ${isDark ? 'bg-gray-800/50' : 'bg-gray-100'}`}>
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Something went wrong
            </h2>
            <p className={`text-sm mb-4 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button
              onClick={this.handleRetry}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                isDark
                  ? 'bg-white/10 text-gray-400 hover:bg-white/20 hover:text-white'
                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300 hover:text-gray-900'
              }`}
            >
              Try again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default function ErrorBoundary(props: Props) {
  const theme = useThemeStore((s) => s.theme)
  const isDark = theme === 'dark'
  return <ErrorBoundaryClass {...props} isDark={isDark} />
}

export function ComponentErrorFallback({ componentType }: { componentType?: string }) {
  const theme = useThemeStore((s) => s.theme)
  const isDark = theme === 'dark'

  return (
    <div className={`p-3 text-sm ${isDark ? 'bg-red-900/20 text-red-400' : 'bg-red-50 text-red-600'}`}>
      Failed to load {componentType || 'component'}
    </div>
  )
}
