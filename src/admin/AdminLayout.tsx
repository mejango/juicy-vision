import { NavLink, Outlet } from 'react-router-dom'
import { useThemeStore, useAuthStore } from '../stores'

export default function AdminLayout() {
  const { theme, setTheme } = useThemeStore()
  const { user, logout } = useAuthStore()
  const isDark = theme === 'dark'

  const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
      isActive
        ? isDark
          ? 'bg-white/10 text-white'
          : 'bg-gray-100 text-gray-900'
        : isDark
          ? 'text-gray-400 hover:text-white hover:bg-white/5'
          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
    }`

  return (
    <div className={`min-h-screen flex ${isDark ? 'bg-zinc-950' : 'bg-gray-50'}`}>
      {/* Sidebar */}
      <aside className={`w-64 border-r flex flex-col ${
        isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-200'
      }`}>
        {/* Logo/Title */}
        <div className={`px-4 py-4 border-b ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
          <h1 className={`text-lg font-bold flex items-center gap-2 ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}>
            <img
              src={isDark ? '/head-dark.png' : '/head-light.png'}
              alt="Juicy Vision"
              className="h-8 w-8"
            />
            Admin
          </h1>
          <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {window.location.hostname}
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2">
          <NavLink to="/" end className={navLinkClasses}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Dashboard
          </NavLink>
          <NavLink to="/chats" className={navLinkClasses}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Chats
          </NavLink>
        </nav>

        {/* User info and settings */}
        <div className={`p-4 border-t ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
          {/* Theme toggle */}
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
              isDark
                ? 'text-gray-400 hover:text-white hover:bg-white/5'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            {isDark ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
            {isDark ? 'Light Mode' : 'Dark Mode'}
          </button>

          {/* User info */}
          <div className={`mt-2 px-3 py-2 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Signed in as
            <div className={`font-medium truncate ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {user?.email || 'Unknown'}
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={() => logout()}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
              isDark
                ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10'
                : 'text-red-500 hover:text-red-600 hover:bg-red-50'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
