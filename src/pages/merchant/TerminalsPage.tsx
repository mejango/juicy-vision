/**
 * Merchant Terminals Page
 *
 * Dashboard for merchants to manage their PayTerm devices,
 * view transactions, and configure settings.
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useThemeStore, useAuthStore } from '../../stores'
import Button from '../../components/ui/Button'
import { getChainName } from '../../components/dynamic/charts/utils'

const API_BASE = import.meta.env.VITE_API_URL || ''

interface TerminalDevice {
  id: string
  name: string
  projectId: number
  chainId: number
  acceptedTokens: string[]
  apiKeyPrefix: string
  isActive: boolean
  lastSeenAt: string | null
  createdAt: string
}

interface PaymentSession {
  id: string
  deviceId: string
  amountUsd: number
  status: string
  paymentMethod: string | null
  txHash: string | null
  createdAt: string
  completedAt: string | null
  merchantId: string
  merchantName: string
  projectId: number
  chainId: number
}

interface MerchantStats {
  totalDevices: number
  activeDevices: number
  totalPayments: number
  completedPayments: number
  totalVolumeUsd: number
  last24hVolumeUsd: number
  last7dVolumeUsd: number
}

type PageView = 'terminals' | 'transactions' | 'new-terminal'

export default function TerminalsPage() {
  const navigate = useNavigate()
  const { theme } = useThemeStore()
  const { token, isAuthenticated } = useAuthStore()
  const isDark = theme === 'dark'

  // State
  const [view, setView] = useState<PageView>('terminals')
  const [devices, setDevices] = useState<TerminalDevice[]>([])
  const [transactions, setTransactions] = useState<PaymentSession[]>([])
  const [stats, setStats] = useState<MerchantStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // New terminal form state
  const [newTerminalName, setNewTerminalName] = useState('')
  const [newTerminalProjectId, setNewTerminalProjectId] = useState('')
  const [newTerminalChainId, setNewTerminalChainId] = useState('42161') // Arbitrum default
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [createLoading, setCreateLoading] = useState(false)

  // Fetch merchant data
  const fetchData = useCallback(async () => {
    if (!token) return

    setLoading(true)
    setError(null)

    try {
      // Fetch in parallel
      const [devicesRes, transactionsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/terminal/devices`, {
          headers: { 'Authorization': `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/terminal/transactions?limit=50`, {
          headers: { 'Authorization': `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/terminal/stats`, {
          headers: { 'Authorization': `Bearer ${token}` },
        }),
      ])

      const [devicesData, transactionsData, statsData] = await Promise.all([
        devicesRes.json(),
        transactionsRes.json(),
        statsRes.json(),
      ])

      if (devicesData.success) setDevices(devicesData.data.devices)
      if (transactionsData.success) setTransactions(transactionsData.data.transactions)
      if (statsData.success) setStats(statsData.data)
    } catch (err) {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/')
      return
    }
    fetchData()
  }, [isAuthenticated, navigate, fetchData])

  // Create new terminal
  const handleCreateTerminal = async () => {
    if (!newTerminalName || !newTerminalProjectId) return

    setCreateLoading(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/terminal/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newTerminalName,
          projectId: parseInt(newTerminalProjectId, 10),
          chainId: parseInt(newTerminalChainId, 10),
        }),
      })

      const data = await res.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to create terminal')
      }

      // Show the API key (only shown once)
      setNewApiKey(data.data.apiKey)
      setDevices(prev => [data.data.device, ...prev])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create terminal')
    } finally {
      setCreateLoading(false)
    }
  }

  // Toggle terminal active status
  const toggleTerminalStatus = async (device: TerminalDevice) => {
    try {
      const res = await fetch(`${API_BASE}/terminal/devices/${device.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: !device.isActive }),
      })

      const data = await res.json()

      if (data.success) {
        setDevices(prev => prev.map(d => d.id === device.id ? data.data.device : d))
      }
    } catch {
      // Ignore
    }
  }

  // Delete terminal
  const deleteTerminal = async (deviceId: string) => {
    if (!confirm('Are you sure you want to delete this terminal?')) return

    try {
      const res = await fetch(`${API_BASE}/terminal/devices/${deviceId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await res.json()

      if (data.success) {
        setDevices(prev => prev.filter(d => d.id !== deviceId))
      }
    } catch {
      // Ignore
    }
  }

  // Regenerate API key
  const regenerateApiKey = async (deviceId: string) => {
    if (!confirm('This will invalidate the current API key. Continue?')) return

    try {
      const res = await fetch(`${API_BASE}/terminal/devices/${deviceId}/regenerate-key`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await res.json()

      if (data.success) {
        alert(`New API Key (save it now, it won't be shown again):\n\n${data.data.apiKey}`)
      }
    } catch {
      // Ignore
    }
  }

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString()
  }

  // Format currency
  const formatUsd = (amount: number) => {
    return `$${amount.toFixed(2)}`
  }

  // Loading state
  if (loading && devices.length === 0) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
        <div className="w-8 h-8 border-2 border-juice-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className={`min-h-screen ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
      {/* Header */}
      <header className={`px-6 py-4 border-b ${isDark ? 'border-white/10 bg-juice-dark-lighter' : 'border-gray-200 bg-white'}`}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              PayTerm Dashboard
            </h1>
            {stats && (
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {stats.activeDevices} active terminal{stats.activeDevices !== 1 ? 's' : ''} &middot; {formatUsd(stats.totalVolumeUsd)} total volume
              </p>
            )}
          </div>
          <Button variant="primary" onClick={() => setView('new-terminal')}>
            New Terminal
          </Button>
        </div>
      </header>

      {/* Stats bar */}
      {stats && (
        <div className={`px-6 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="max-w-4xl mx-auto grid grid-cols-4 gap-4">
            <div>
              <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>24h Volume</p>
              <p className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {formatUsd(stats.last24hVolumeUsd)}
              </p>
            </div>
            <div>
              <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>7d Volume</p>
              <p className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {formatUsd(stats.last7dVolumeUsd)}
              </p>
            </div>
            <div>
              <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Completed</p>
              <p className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {stats.completedPayments}
              </p>
            </div>
            <div>
              <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Terminals</p>
              <p className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {stats.activeDevices} / {stats.totalDevices}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className={`px-6 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className="max-w-4xl mx-auto flex gap-6">
          <button
            onClick={() => setView('terminals')}
            className={`py-3 text-sm font-medium border-b-2 transition-colors ${
              view === 'terminals'
                ? isDark ? 'border-juice-cyan text-white' : 'border-juice-cyan text-gray-900'
                : isDark ? 'border-transparent text-gray-500 hover:text-gray-300' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Terminals
          </button>
          <button
            onClick={() => setView('transactions')}
            className={`py-3 text-sm font-medium border-b-2 transition-colors ${
              view === 'transactions'
                ? isDark ? 'border-juice-cyan text-white' : 'border-juice-cyan text-gray-900'
                : isDark ? 'border-transparent text-gray-500 hover:text-gray-300' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Transactions
          </button>
        </div>
      </div>

      {/* Content */}
      <main className="px-6 py-6">
        <div className="max-w-4xl mx-auto">
          {error && (
            <div className={`mb-4 px-4 py-3 border ${isDark ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
              {error}
            </div>
          )}

          {/* Terminals List */}
          {view === 'terminals' && (
            <div className="space-y-4">
              {devices.length === 0 ? (
                <div className={`text-center py-12 border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                  <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    No terminals yet. Create your first one to start accepting payments.
                  </p>
                  <Button variant="primary" onClick={() => setView('new-terminal')} className="mt-4">
                    Create Terminal
                  </Button>
                </div>
              ) : (
                devices.map(device => (
                  <div
                    key={device.id}
                    className={`p-4 border ${isDark ? 'border-white/10 bg-juice-dark-lighter' : 'border-gray-200 bg-white'}`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            {device.name}
                          </h3>
                          <span className={`px-2 py-0.5 text-xs ${
                            device.isActive
                              ? 'bg-green-500/20 text-green-400'
                              : isDark ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {device.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          Project #{device.projectId} on {getChainName(device.chainId)}
                        </p>
                        <p className={`text-xs mt-1 font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          API Key: {device.apiKeyPrefix}...
                        </p>
                        {device.lastSeenAt && (
                          <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            Last seen: {formatDate(device.lastSeenAt)}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleTerminalStatus(device)}
                        >
                          {device.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => regenerateApiKey(device.id)}
                        >
                          Regenerate Key
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => deleteTerminal(device.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Transactions List */}
          {view === 'transactions' && (
            <div className="space-y-2">
              {transactions.length === 0 ? (
                <div className={`text-center py-12 border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                  <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    No transactions yet.
                  </p>
                </div>
              ) : (
                transactions.map(tx => (
                  <div
                    key={tx.id}
                    className={`p-4 border ${isDark ? 'border-white/10 bg-juice-dark-lighter' : 'border-gray-200 bg-white'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 flex items-center justify-center ${
                          tx.status === 'completed' ? 'bg-green-500/20' :
                          tx.status === 'failed' ? 'bg-red-500/20' :
                          isDark ? 'bg-white/10' : 'bg-gray-100'
                        }`}>
                          {tx.status === 'completed' ? (
                            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : tx.status === 'failed' ? (
                            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          ) : (
                            <svg className={`w-5 h-5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            {formatUsd(tx.amountUsd)}
                          </p>
                          <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            {formatDate(tx.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-xs px-2 py-1 ${
                          tx.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                          tx.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                          tx.status === 'expired' ? isDark ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500' :
                          'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {tx.status}
                        </span>
                        {tx.paymentMethod && (
                          <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            via {tx.paymentMethod}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* New Terminal Form */}
          {view === 'new-terminal' && (
            <div className={`max-w-md mx-auto p-6 border ${isDark ? 'border-white/10 bg-juice-dark-lighter' : 'border-gray-200 bg-white'}`}>
              {newApiKey ? (
                // Show API key after creation
                <div className="text-center space-y-4">
                  <div className={`w-12 h-12 mx-auto flex items-center justify-center bg-green-500`}>
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    Terminal Created!
                  </h2>
                  <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Save this API key now. It won't be shown again.
                  </p>
                  <div className={`p-3 font-mono text-xs break-all ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'} border`}>
                    {newApiKey}
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="secondary"
                      onClick={() => navigator.clipboard.writeText(newApiKey)}
                      className="flex-1"
                    >
                      Copy
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => {
                        setNewApiKey(null)
                        setNewTerminalName('')
                        setNewTerminalProjectId('')
                        setView('terminals')
                      }}
                      className="flex-1"
                    >
                      Done
                    </Button>
                  </div>
                </div>
              ) : (
                // Creation form
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      New Terminal
                    </h2>
                    <button
                      onClick={() => setView('terminals')}
                      className={`text-sm ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Cancel
                    </button>
                  </div>

                  <div>
                    <label className={`block text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Terminal Name
                    </label>
                    <input
                      type="text"
                      value={newTerminalName}
                      onChange={(e) => setNewTerminalName(e.target.value)}
                      placeholder="e.g., Coffee Shop Register"
                      className={`w-full px-3 py-2 text-sm border ${
                        isDark
                          ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                          : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                      } focus:border-juice-cyan outline-none`}
                    />
                  </div>

                  <div>
                    <label className={`block text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Juicebox Project ID
                    </label>
                    <input
                      type="number"
                      value={newTerminalProjectId}
                      onChange={(e) => setNewTerminalProjectId(e.target.value)}
                      placeholder="e.g., 123"
                      className={`w-full px-3 py-2 text-sm border ${
                        isDark
                          ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                          : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                      } focus:border-juice-cyan outline-none`}
                    />
                  </div>

                  <div>
                    <label className={`block text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Chain
                    </label>
                    <select
                      value={newTerminalChainId}
                      onChange={(e) => setNewTerminalChainId(e.target.value)}
                      className={`w-full px-3 py-2 text-sm border ${
                        isDark
                          ? 'bg-white/5 border-white/10 text-white'
                          : 'bg-gray-50 border-gray-200 text-gray-900'
                      } focus:border-juice-cyan outline-none`}
                    >
                      <option value="42161">Arbitrum (Recommended)</option>
                      <option value="8453">Base</option>
                      <option value="10">Optimism</option>
                      <option value="1">Ethereum</option>
                    </select>
                  </div>

                  <Button
                    variant="primary"
                    onClick={handleCreateTerminal}
                    loading={createLoading}
                    disabled={!newTerminalName || !newTerminalProjectId}
                    className="w-full"
                  >
                    Create Terminal
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
