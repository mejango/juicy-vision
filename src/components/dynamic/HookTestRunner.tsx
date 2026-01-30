import { useState, useEffect, useRef, useCallback } from 'react'
import { useThemeStore, useAuthStore } from '../../stores'

interface TestResult {
  name: string
  passed: boolean
  gasUsed?: number
  duration?: number
  logs?: string[]
  error?: string
}

interface ForkConfig {
  chainId: number
  blockNumber?: number
}

interface HookTestRunnerProps {
  projectId: string
  forkConfig?: ForkConfig | string
  autoRun?: boolean
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum Mainnet',
  10: 'Optimism',
  8453: 'Base',
  42161: 'Arbitrum One',
  11155111: 'Sepolia',
  84532: 'Base Sepolia',
}

export default function HookTestRunner({
  projectId,
  forkConfig: initialForkConfig,
  autoRun = false,
}: HookTestRunnerProps) {
  const { theme } = useThemeStore()
  const token = useAuthStore((s) => s.token)
  const isDark = theme === 'dark'

  // Parse fork config if string
  const forkConfig: ForkConfig | undefined =
    typeof initialForkConfig === 'string'
      ? JSON.parse(initialForkConfig)
      : initialForkConfig

  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle')
  const [output, setOutput] = useState<string>('')
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedChainId, setSelectedChainId] = useState(forkConfig?.chainId || 1)
  const outputRef = useRef<HTMLDivElement>(null)

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  // Auto-run on mount
  useEffect(() => {
    if (autoRun && status === 'idle') {
      runTests()
    }
  }, [autoRun])

  const runTests = useCallback(async () => {
    if (!token) {
      setError('Authentication required')
      return
    }

    setStatus('running')
    setOutput('')
    setTestResults([])
    setError(null)

    try {
      // Submit test job
      const submitResponse = await fetch('/hooks/forge/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jobType: 'test',
          projectId,
          forkConfig: { chainId: selectedChainId },
        }),
      })

      if (!submitResponse.ok) {
        const data = await submitResponse.json()
        throw new Error(data.error || 'Failed to submit test job')
      }

      const { data: job } = await submitResponse.json()
      setJobId(job.id)

      // Stream output via SSE
      const eventSource = new EventSource(
        `/hooks/forge/stream/${job.id}?token=${encodeURIComponent(token)}`
      )

      eventSource.addEventListener('output', (event) => {
        setOutput(prev => prev + event.data)
      })

      eventSource.addEventListener('status', (event) => {
        const { status: jobStatus, resultData } = JSON.parse(event.data)

        if (jobStatus === 'completed' || jobStatus === 'failed' || jobStatus === 'timeout') {
          setStatus(jobStatus === 'completed' ? 'completed' : 'failed')

          if (resultData?.testResults) {
            setTestResults(resultData.testResults)
          }

          if (resultData?.errors?.length > 0) {
            setError(resultData.errors.map((e: { message: string }) => e.message).join('\n'))
          }
        }
      })

      eventSource.addEventListener('done', (event) => {
        const finalJob = JSON.parse(event.data)
        setStatus(finalJob.status === 'completed' ? 'completed' : 'failed')
        eventSource.close()
      })

      eventSource.onerror = () => {
        eventSource.close()
        if (status === 'running') {
          setError('Connection lost')
          setStatus('failed')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStatus('failed')
    }
  }, [token, projectId, selectedChainId])

  const passedCount = testResults.filter(t => t.passed).length
  const failedCount = testResults.filter(t => !t.passed).length
  const totalGas = testResults.reduce((sum, t) => sum + (t.gasUsed || 0), 0)

  return (
    <div className={`w-full border ${isDark ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-white'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2 border-b ${
        isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-100'
      }`}>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            Test Runner
          </span>
          {status === 'running' && (
            <span className="flex items-center gap-1 text-xs text-yellow-500">
              <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
              Running...
            </span>
          )}
          {status === 'completed' && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Complete
            </span>
          )}
          {status === 'failed' && (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              Failed
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Chain selector for fork tests */}
          <select
            value={selectedChainId}
            onChange={(e) => setSelectedChainId(parseInt(e.target.value))}
            disabled={status === 'running'}
            className={`px-2 py-1 text-xs border ${
              isDark
                ? 'bg-gray-900 border-gray-700 text-gray-300'
                : 'bg-white border-gray-300 text-gray-600'
            }`}
          >
            {Object.entries(CHAIN_NAMES).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>

          <button
            onClick={runTests}
            disabled={status === 'running'}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              status === 'running'
                ? 'bg-gray-500/30 text-gray-500 cursor-not-allowed'
                : isDark
                  ? 'bg-green-600 hover:bg-green-500 text-white'
                  : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            {status === 'running' ? 'Running...' : 'Run Tests'}
          </button>
        </div>
      </div>

      {/* Test results summary */}
      {testResults.length > 0 && (
        <div className={`px-3 py-2 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-green-500">{passedCount} passed</span>
            {failedCount > 0 && <span className="text-red-500">{failedCount} failed</span>}
            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
              {totalGas.toLocaleString()} gas used
            </span>
          </div>
        </div>
      )}

      {/* Test results list */}
      {testResults.length > 0 && (
        <div className={`max-h-48 overflow-y-auto border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          {testResults.map((test, i) => (
            <div
              key={i}
              className={`px-3 py-2 flex items-center justify-between ${
                i !== testResults.length - 1 ? (isDark ? 'border-b border-gray-800' : 'border-b border-gray-100') : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-lg ${test.passed ? 'text-green-500' : 'text-red-500'}`}>
                  {test.passed ? '✓' : '✗'}
                </span>
                <span className={`text-sm font-mono ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {test.name}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {test.gasUsed && (
                  <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
                    {test.gasUsed.toLocaleString()} gas
                  </span>
                )}
                {test.duration && (
                  <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
                    {test.duration}ms
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className={`px-3 py-2 text-sm text-red-400 border-b ${
          isDark ? 'border-gray-700 bg-red-900/20' : 'border-gray-200 bg-red-50'
        }`}>
          {error}
        </div>
      )}

      {/* Console output */}
      <div
        ref={outputRef}
        className={`h-48 overflow-y-auto p-3 font-mono text-xs ${
          isDark ? 'bg-black text-gray-300' : 'bg-gray-900 text-gray-100'
        }`}
      >
        {output ? (
          <pre className="whitespace-pre-wrap">{output}</pre>
        ) : status === 'idle' ? (
          <span className="text-gray-500">Click "Run Tests" to start...</span>
        ) : (
          <span className="text-gray-500">Waiting for output...</span>
        )}
      </div>

      {/* Footer */}
      <div className={`px-3 py-1.5 border-t text-xs ${
        isDark ? 'border-gray-700 text-gray-500' : 'border-gray-200 text-gray-400'
      }`}>
        {jobId ? `Job: ${jobId.substring(0, 8)}...` : 'No job running'}
        {forkConfig?.blockNumber && ` • Block: ${forkConfig.blockNumber}`}
      </div>
    </div>
  )
}
