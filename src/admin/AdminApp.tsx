import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore, useThemeStore } from '../stores'
import AdminLayout from './AdminLayout'
import DashboardPage from './pages/DashboardPage'
import ChatsPage from './pages/ChatsPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
    },
  },
})

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, token, _hasHydrated } = useAuthStore()
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const [timedOut, setTimedOut] = useState(false)

  // Fallback timeout in case hydration gets stuck
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 1000)
    return () => clearTimeout(timer)
  }, [])

  // Wait for auth store hydration (with timeout fallback)
  if (!_hasHydrated && !timedOut) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        isDark ? 'bg-zinc-950' : 'bg-gray-50'
      }`}>
        <div className="w-8 h-8 border-2 border-juice-orange border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Not authenticated - show login
  if (!token || !user) {
    return <AdminLogin />
  }

  // Not an admin - show access denied
  // TODO: Re-enable admin check after testing
  // if (!user.isAdmin) {
  //   return <AccessDenied />
  // }

  return <>{children}</>
}

function AdminLogin() {
  const { theme } = useThemeStore()
  const { loginWithPasskey, isLoading } = useAuthStore()
  const isDark = theme === 'dark'
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async () => {
    setError(null)
    try {
      await loginWithPasskey(undefined, 'this-device')
    } catch (err) {
      if (err instanceof Error) {
        const msg = err.message.toLowerCase()
        if (msg.includes('cancelled') || msg.includes('abort') || msg.includes('not allowed')) {
          return // User cancelled
        }
        setError(err.message)
      } else {
        setError('Login failed')
      }
    }
  }

  return (
    <div className={`min-h-screen flex items-center justify-center ${
      isDark ? 'bg-zinc-950' : 'bg-gray-50'
    }`}>
      <div className={`w-full max-w-md p-8 ${
        isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-gray-200'
      }`}>
        <div className="text-center mb-6">
          <img
            src={isDark ? '/head-dark.png' : '/head-light.png'}
            alt="Juicy Vision"
            className="h-16 w-16 mx-auto mb-4"
          />
          <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Admin Dashboard
          </h1>
          <p className={`text-sm mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Sign in with your admin account
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={isLoading}
          className={`w-full py-3 text-sm font-medium transition-colors ${
            isLoading
              ? 'bg-gray-600 text-gray-400 cursor-wait'
              : 'bg-juice-orange text-juice-dark hover:bg-juice-orange/90'
          }`}
        >
          {isLoading ? 'Signing in...' : 'Sign in with Touch ID'}
        </button>

        <p className={`text-xs text-center mt-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Only admin accounts can access this dashboard
        </p>
      </div>
    </div>
  )
}

function AccessDenied() {
  const { theme } = useThemeStore()
  const { user, logout } = useAuthStore()
  const isDark = theme === 'dark'

  return (
    <div className={`min-h-screen flex items-center justify-center ${
      isDark ? 'bg-zinc-950' : 'bg-gray-50'
    }`}>
      <div className={`w-full max-w-md p-8 text-center ${
        isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-gray-200'
      }`}>
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Access Denied
        </h1>
        <p className={`text-sm mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          You don't have admin privileges.
          {user?.email && (
            <span className="block mt-1">
              Signed in as: {user.email}
            </span>
          )}
        </p>
        <button
          onClick={() => logout()}
          className={`mt-6 px-4 py-2 text-sm font-medium transition-colors ${
            isDark
              ? 'bg-white/10 text-white hover:bg-white/20'
              : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
          }`}
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}

export default function AdminApp() {
  const { theme } = useThemeStore()

  useEffect(() => {
    document.documentElement.className = theme
  }, [theme])

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate>
          <Routes>
            <Route path="/" element={<AdminLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="chats" element={<ChatsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
