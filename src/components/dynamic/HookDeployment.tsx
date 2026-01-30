import { useState, useEffect, useMemo, useCallback } from 'react'
import { useThemeStore, useAuthStore } from '../../stores'
import { useAccount } from 'wagmi'

interface ChainDeployment {
  chainId: number
  status: 'pending' | 'deploying' | 'deployed' | 'failed'
  address?: string
  txHash?: string
  error?: string
}

interface HookDeploymentProps {
  projectId: string
  chainIds?: number[] | string
  constructorArgs?: unknown[] | string
}

const CHAIN_INFO: Record<number, { name: string; explorer: string; slug: string }> = {
  1: { name: 'Ethereum', explorer: 'https://etherscan.io', slug: 'eth' },
  10: { name: 'Optimism', explorer: 'https://optimistic.etherscan.io', slug: 'op' },
  8453: { name: 'Base', explorer: 'https://basescan.org', slug: 'base' },
  42161: { name: 'Arbitrum', explorer: 'https://arbiscan.io', slug: 'arb' },
  11155111: { name: 'Sepolia', explorer: 'https://sepolia.etherscan.io', slug: 'sepolia' },
  84532: { name: 'Base Sepolia', explorer: 'https://sepolia.basescan.org', slug: 'base-sepolia' },
}

const DEFAULT_CHAINS = [1, 10, 8453]

export default function HookDeployment({
  projectId,
  chainIds: initialChainIds,
  constructorArgs: initialConstructorArgs,
}: HookDeploymentProps) {
  const { theme } = useThemeStore()
  const token = useAuthStore((s) => s.token)
  const { address, isConnected } = useAccount()
  const isDark = theme === 'dark'

  // Parse props
  const chainIds = useMemo(() => {
    if (!initialChainIds) return DEFAULT_CHAINS
    if (typeof initialChainIds === 'string') {
      try {
        return JSON.parse(initialChainIds)
      } catch {
        return DEFAULT_CHAINS
      }
    }
    return initialChainIds
  }, [initialChainIds])

  const constructorArgs = useMemo(() => {
    if (!initialConstructorArgs) return []
    if (typeof initialConstructorArgs === 'string') {
      try {
        return JSON.parse(initialConstructorArgs)
      } catch {
        return []
      }
    }
    return initialConstructorArgs
  }, [initialConstructorArgs])

  const [selectedChains, setSelectedChains] = useState<number[]>(chainIds)
  const [deployments, setDeployments] = useState<ChainDeployment[]>([])
  const [isDeploying, setIsDeploying] = useState(false)
  const [securityCheckPassed, setSecurityCheckPassed] = useState<boolean | null>(null)
  const [securityWarnings, setSecurityWarnings] = useState<string[]>([])
  const [step, setStep] = useState<'select' | 'security' | 'deploy' | 'complete'>('select')
  const [error, setError] = useState<string | null>(null)

  // Check security before deployment
  const runSecurityCheck = useCallback(async () => {
    if (!token) return

    setStep('security')
    setError(null)

    try {
      const response = await fetch(`/hooks/projects/${projectId}/check-deploy`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Security check failed')
      }

      const { data } = await response.json()
      setSecurityCheckPassed(data.canDeploy)
      setSecurityWarnings(data.warnings || [])

      if (!data.canDeploy && data.criticalFindings?.length > 0) {
        setError(`Critical security issues found: ${data.criticalFindings.map((f: { title: string }) => f.title).join(', ')}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setSecurityCheckPassed(false)
    }
  }, [token, projectId])

  // Deploy to selected chains
  const startDeployment = useCallback(async () => {
    if (!token || !isConnected) return

    setStep('deploy')
    setIsDeploying(true)
    setError(null)

    // Initialize deployment status for all chains
    setDeployments(
      selectedChains.map(chainId => ({
        chainId,
        status: 'pending',
      }))
    )

    // For now, we simulate deployment - in production this would use Relayr
    for (const chainId of selectedChains) {
      setDeployments(prev =>
        prev.map(d =>
          d.chainId === chainId ? { ...d, status: 'deploying' } : d
        )
      )

      try {
        // Simulate deployment delay
        await new Promise(resolve => setTimeout(resolve, 2000))

        // Mock successful deployment
        const mockAddress = `0x${Math.random().toString(16).substring(2, 42).padEnd(40, '0')}`
        const mockTxHash = `0x${Math.random().toString(16).substring(2, 66).padEnd(64, '0')}`

        setDeployments(prev =>
          prev.map(d =>
            d.chainId === chainId
              ? { ...d, status: 'deployed', address: mockAddress, txHash: mockTxHash }
              : d
          )
        )
      } catch (err) {
        setDeployments(prev =>
          prev.map(d =>
            d.chainId === chainId
              ? { ...d, status: 'failed', error: err instanceof Error ? err.message : 'Deployment failed' }
              : d
          )
        )
      }
    }

    setIsDeploying(false)

    // Mark project as deployed
    const deployedAddresses: Record<string, string> = {}
    for (const d of deployments) {
      if (d.status === 'deployed' && d.address) {
        deployedAddresses[d.chainId.toString()] = d.address
      }
    }

    if (Object.keys(deployedAddresses).length > 0) {
      try {
        await fetch(`/hooks/projects/${projectId}/deploy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ deployedAddresses }),
        })
      } catch {
        // Non-critical error
      }
    }

    setStep('complete')
  }, [token, isConnected, selectedChains, projectId])

  const toggleChain = (chainId: number) => {
    setSelectedChains(prev =>
      prev.includes(chainId)
        ? prev.filter(c => c !== chainId)
        : [...prev, chainId]
    )
  }

  const allDeployed = deployments.length > 0 && deployments.every(d => d.status === 'deployed')
  const anyFailed = deployments.some(d => d.status === 'failed')

  return (
    <div className={`w-full border ${isDark ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-white'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2 border-b ${
        isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-100'
      }`}>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            Deploy Hook
          </span>
          {step === 'complete' && allDeployed && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Deployed
            </span>
          )}
          {step === 'complete' && anyFailed && (
            <span className="flex items-center gap-1 text-xs text-yellow-500">
              <span className="w-2 h-2 rounded-full bg-yellow-500" />
              Partial
            </span>
          )}
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs">
          <span className={step === 'select' ? (isDark ? 'text-white' : 'text-gray-900') : (isDark ? 'text-gray-500' : 'text-gray-400')}>
            1. Select
          </span>
          <span className={isDark ? 'text-gray-600' : 'text-gray-300'}>→</span>
          <span className={step === 'security' ? (isDark ? 'text-white' : 'text-gray-900') : (isDark ? 'text-gray-500' : 'text-gray-400')}>
            2. Security
          </span>
          <span className={isDark ? 'text-gray-600' : 'text-gray-300'}>→</span>
          <span className={step === 'deploy' || step === 'complete' ? (isDark ? 'text-white' : 'text-gray-900') : (isDark ? 'text-gray-500' : 'text-gray-400')}>
            3. Deploy
          </span>
        </div>
      </div>

      {/* Step 1: Chain Selection */}
      {step === 'select' && (
        <div className="p-4">
          <p className={`text-sm mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Select chains to deploy your hook to:
          </p>

          <div className="grid grid-cols-2 gap-2 mb-4">
            {Object.entries(CHAIN_INFO).map(([id, info]) => {
              const chainId = parseInt(id)
              const isSelected = selectedChains.includes(chainId)

              return (
                <button
                  key={chainId}
                  onClick={() => toggleChain(chainId)}
                  className={`flex items-center gap-2 px-3 py-2 text-sm border transition-colors ${
                    isSelected
                      ? isDark
                        ? 'border-blue-500 bg-blue-900/30 text-blue-300'
                        : 'border-blue-500 bg-blue-50 text-blue-700'
                      : isDark
                        ? 'border-gray-700 text-gray-400 hover:border-gray-600'
                        : 'border-gray-300 text-gray-500 hover:border-gray-400'
                  }`}
                >
                  <span className={`w-4 h-4 border flex items-center justify-center ${
                    isSelected
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : isDark ? 'border-gray-600' : 'border-gray-300'
                  }`}>
                    {isSelected && '✓'}
                  </span>
                  {info.name}
                </button>
              )
            })}
          </div>

          <button
            onClick={runSecurityCheck}
            disabled={selectedChains.length === 0}
            className={`w-full py-2.5 text-sm font-medium transition-colors ${
              selectedChains.length === 0
                ? 'bg-gray-500/30 text-gray-500 cursor-not-allowed'
                : isDark
                  ? 'bg-purple-600 hover:bg-purple-500 text-white'
                  : 'bg-purple-500 hover:bg-purple-600 text-white'
            }`}
          >
            Run Security Check
          </button>
        </div>
      )}

      {/* Step 2: Security Check */}
      {step === 'security' && (
        <div className="p-4">
          {securityCheckPassed === null && (
            <div className={`flex items-center gap-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              <span className="w-4 h-4 border-2 border-t-transparent border-blue-500 rounded-full animate-spin" />
              <span className="text-sm">Running security checks...</span>
            </div>
          )}

          {securityCheckPassed === true && (
            <div>
              <div className="flex items-center gap-2 text-green-500 mb-3">
                <span className="text-lg">✅</span>
                <span className="text-sm font-medium">Security check passed</span>
              </div>

              {securityWarnings.length > 0 && (
                <div className={`mb-3 p-2 text-xs ${
                  isDark ? 'bg-yellow-900/20 text-yellow-400' : 'bg-yellow-50 text-yellow-700'
                }`}>
                  <div className="font-medium mb-1">Warnings:</div>
                  <ul className="list-disc list-inside">
                    {securityWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                onClick={startDeployment}
                disabled={!isConnected}
                className={`w-full py-2.5 text-sm font-medium transition-colors ${
                  !isConnected
                    ? 'bg-gray-500/30 text-gray-500 cursor-not-allowed'
                    : isDark
                      ? 'bg-green-600 hover:bg-green-500 text-white'
                      : 'bg-green-500 hover:bg-green-600 text-white'
                }`}
              >
                {isConnected ? 'Deploy to Selected Chains' : 'Connect Wallet to Deploy'}
              </button>
            </div>
          )}

          {securityCheckPassed === false && (
            <div>
              <div className="flex items-center gap-2 text-red-500 mb-3">
                <span className="text-lg">❌</span>
                <span className="text-sm font-medium">Security check failed</span>
              </div>

              {error && (
                <p className={`text-sm mb-3 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                  {error}
                </p>
              )}

              <button
                onClick={() => setStep('select')}
                className={`w-full py-2.5 text-sm font-medium ${
                  isDark
                    ? 'bg-gray-700 hover:bg-gray-600 text-white'
                    : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                }`}
              >
                Go Back
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Deployment Progress */}
      {(step === 'deploy' || step === 'complete') && (
        <div className="p-4">
          <div className="space-y-2">
            {deployments.map(d => {
              const chain = CHAIN_INFO[d.chainId]
              return (
                <div
                  key={d.chainId}
                  className={`flex items-center justify-between p-3 border ${
                    d.status === 'deployed'
                      ? isDark ? 'border-green-500/30 bg-green-900/20' : 'border-green-200 bg-green-50'
                      : d.status === 'failed'
                        ? isDark ? 'border-red-500/30 bg-red-900/20' : 'border-red-200 bg-red-50'
                        : isDark ? 'border-gray-700' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {d.status === 'pending' && (
                      <span className={`w-4 h-4 rounded-full ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`} />
                    )}
                    {d.status === 'deploying' && (
                      <span className="w-4 h-4 border-2 border-t-transparent border-blue-500 rounded-full animate-spin" />
                    )}
                    {d.status === 'deployed' && (
                      <span className="text-green-500">✓</span>
                    )}
                    {d.status === 'failed' && (
                      <span className="text-red-500">✗</span>
                    )}
                    <span className={`text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                      {chain?.name || `Chain ${d.chainId}`}
                    </span>
                  </div>

                  <div className="text-right">
                    {d.status === 'deployed' && d.address && (
                      <a
                        href={`${chain?.explorer}/address/${d.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`text-xs font-mono ${
                          isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
                        }`}
                      >
                        {d.address.substring(0, 6)}...{d.address.substring(38)}
                      </a>
                    )}
                    {d.status === 'deploying' && (
                      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        Deploying...
                      </span>
                    )}
                    {d.status === 'failed' && (
                      <span className="text-xs text-red-400">
                        {d.error || 'Failed'}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {step === 'complete' && (
            <div className={`mt-4 pt-4 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
              {allDeployed ? (
                <div className={`text-center text-sm ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                  🎉 Deployment complete! Your hook is live.
                </div>
              ) : anyFailed ? (
                <button
                  onClick={() => setStep('select')}
                  className={`w-full py-2 text-sm ${
                    isDark
                      ? 'bg-gray-700 hover:bg-gray-600 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                  }`}
                >
                  Retry Failed Deployments
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
