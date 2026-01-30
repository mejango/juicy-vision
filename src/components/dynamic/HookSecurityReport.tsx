import { useState, useEffect, useCallback } from 'react'
import { useThemeStore, useAuthStore } from '../../stores'

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

interface SecurityFinding {
  id: string
  tool: string
  ruleId: string
  severity: Severity
  title: string
  message: string
  file: string
  line: number
  endLine?: number
  column?: number
  code?: string
  fix?: string
  references?: string[]
}

interface AnalysisSummary {
  critical: number
  high: number
  medium: number
  low: number
  info: number
}

interface HookSecurityReportProps {
  projectId: string
  autoRun?: boolean
}

const SEVERITY_COLORS: Record<Severity, { bg: string; text: string; border: string }> = {
  critical: {
    bg: 'bg-red-900/30',
    text: 'text-red-400',
    border: 'border-red-500/50',
  },
  high: {
    bg: 'bg-orange-900/30',
    text: 'text-orange-400',
    border: 'border-orange-500/50',
  },
  medium: {
    bg: 'bg-yellow-900/30',
    text: 'text-yellow-400',
    border: 'border-yellow-500/50',
  },
  low: {
    bg: 'bg-blue-900/30',
    text: 'text-blue-400',
    border: 'border-blue-500/50',
  },
  info: {
    bg: 'bg-gray-800/30',
    text: 'text-gray-400',
    border: 'border-gray-500/50',
  },
}

const SEVERITY_ICONS: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: '⚪',
}

export default function HookSecurityReport({
  projectId,
  autoRun = false,
}: HookSecurityReportProps) {
  const { theme } = useThemeStore()
  const token = useAuthStore((s) => s.token)
  const isDark = theme === 'dark'

  const [status, setStatus] = useState<'idle' | 'loading' | 'complete' | 'error'>('idle')
  const [findings, setFindings] = useState<SecurityFinding[]>([])
  const [summary, setSummary] = useState<AnalysisSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null)
  const [filterSeverity, setFilterSeverity] = useState<Severity | 'all'>('all')

  const runAnalysis = useCallback(async () => {
    if (!token) {
      setError('Authentication required')
      return
    }

    setStatus('loading')
    setError(null)

    try {
      const response = await fetch(`/hooks/projects/${projectId}/analyze`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Analysis failed')
      }

      const { data } = await response.json()
      setFindings(data.findings || [])
      setSummary(data.summary || null)
      setStatus('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStatus('error')
    }
  }, [token, projectId])

  // Auto-run on mount
  useEffect(() => {
    if (autoRun && status === 'idle') {
      runAnalysis()
    }
  }, [autoRun, status, runAnalysis])

  // Filter findings
  const filteredFindings = filterSeverity === 'all'
    ? findings
    : findings.filter(f => f.severity === filterSeverity)

  // Group by file
  const findingsByFile = filteredFindings.reduce<Record<string, SecurityFinding[]>>(
    (acc, finding) => {
      const file = finding.file || 'Unknown'
      if (!acc[file]) acc[file] = []
      acc[file].push(finding)
      return acc
    },
    {}
  )

  const totalFindings = findings.length
  const hasCritical = (summary?.critical || 0) > 0
  const hasHigh = (summary?.high || 0) > 0

  return (
    <div className={`w-full border ${isDark ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-white'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2 border-b ${
        isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-100'
      }`}>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            Security Analysis
          </span>
          {status === 'loading' && (
            <span className="flex items-center gap-1 text-xs text-yellow-500">
              <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
              Analyzing...
            </span>
          )}
          {status === 'complete' && totalFindings === 0 && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              No issues found
            </span>
          )}
          {status === 'complete' && totalFindings > 0 && (
            <span className={`flex items-center gap-1 text-xs ${
              hasCritical ? 'text-red-500' : hasHigh ? 'text-orange-500' : 'text-yellow-500'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                hasCritical ? 'bg-red-500' : hasHigh ? 'bg-orange-500' : 'bg-yellow-500'
              }`} />
              {totalFindings} {totalFindings === 1 ? 'issue' : 'issues'} found
            </span>
          )}
        </div>

        <button
          onClick={runAnalysis}
          disabled={status === 'loading'}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            status === 'loading'
              ? 'bg-gray-500/30 text-gray-500 cursor-not-allowed'
              : isDark
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-purple-500 hover:bg-purple-600 text-white'
          }`}
        >
          {status === 'loading' ? 'Analyzing...' : 'Run Analysis'}
        </button>
      </div>

      {/* Summary */}
      {summary && status === 'complete' && (
        <div className={`px-3 py-2 border-b flex items-center gap-4 ${
          isDark ? 'border-gray-700' : 'border-gray-200'
        }`}>
          {(['critical', 'high', 'medium', 'low', 'info'] as Severity[]).map(severity => (
            <button
              key={severity}
              onClick={() => setFilterSeverity(filterSeverity === severity ? 'all' : severity)}
              className={`flex items-center gap-1 text-xs px-2 py-1 transition-colors ${
                filterSeverity === severity
                  ? `${SEVERITY_COLORS[severity].bg} ${SEVERITY_COLORS[severity].text} border ${SEVERITY_COLORS[severity].border}`
                  : isDark
                    ? 'text-gray-400 hover:text-gray-300'
                    : 'text-gray-500 hover:text-gray-600'
              }`}
            >
              <span>{SEVERITY_ICONS[severity]}</span>
              <span className="capitalize">{severity}</span>
              <span className="font-medium">{summary[severity]}</span>
            </button>
          ))}
          {filterSeverity !== 'all' && (
            <button
              onClick={() => setFilterSeverity('all')}
              className={`text-xs ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
            >
              Clear filter
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className={`px-3 py-2 text-sm text-red-400 ${
          isDark ? 'bg-red-900/20' : 'bg-red-50'
        }`}>
          {error}
        </div>
      )}

      {/* Findings */}
      {status === 'complete' && filteredFindings.length > 0 && (
        <div className="max-h-96 overflow-y-auto">
          {Object.entries(findingsByFile).map(([file, fileFindings]) => (
            <div key={file} className={`border-b ${isDark ? 'border-gray-800' : 'border-gray-100'}`}>
              {/* File header */}
              <div className={`px-3 py-1.5 text-xs font-mono ${
                isDark ? 'bg-gray-850 text-gray-400' : 'bg-gray-50 text-gray-500'
              }`}>
                {file}
              </div>

              {/* Findings in file */}
              {fileFindings.map(finding => (
                <div
                  key={finding.id}
                  className={`border-l-2 ${SEVERITY_COLORS[finding.severity].border}`}
                >
                  <button
                    onClick={() => setExpandedFinding(
                      expandedFinding === finding.id ? null : finding.id
                    )}
                    className={`w-full px-3 py-2 text-left ${
                      isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm">{SEVERITY_ICONS[finding.severity]}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${
                            isDark ? 'text-gray-200' : 'text-gray-800'
                          }`}>
                            {finding.title}
                          </span>
                          <span className={`text-xs ${
                            isDark ? 'text-gray-500' : 'text-gray-400'
                          }`}>
                            Line {finding.line}
                          </span>
                        </div>
                        <p className={`text-xs mt-0.5 ${
                          isDark ? 'text-gray-400' : 'text-gray-500'
                        }`}>
                          {finding.message.length > 100 && expandedFinding !== finding.id
                            ? finding.message.substring(0, 100) + '...'
                            : finding.message
                          }
                        </p>
                      </div>
                      <svg
                        className={`w-4 h-4 transition-transform ${
                          expandedFinding === finding.id ? 'rotate-180' : ''
                        } ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Expanded details */}
                  {expandedFinding === finding.id && (
                    <div className={`px-3 py-2 ml-6 ${
                      isDark ? 'bg-gray-850' : 'bg-gray-50'
                    }`}>
                      {finding.code && (
                        <div className="mb-2">
                          <div className={`text-xs font-medium mb-1 ${
                            isDark ? 'text-gray-400' : 'text-gray-500'
                          }`}>
                            Code:
                          </div>
                          <pre className={`text-xs font-mono p-2 overflow-x-auto ${
                            isDark ? 'bg-gray-900 text-gray-300' : 'bg-gray-100 text-gray-700'
                          }`}>
                            {finding.code}
                          </pre>
                        </div>
                      )}

                      {finding.fix && (
                        <div className="mb-2">
                          <div className={`text-xs font-medium mb-1 ${
                            isDark ? 'text-gray-400' : 'text-gray-500'
                          }`}>
                            Suggested fix:
                          </div>
                          <p className={`text-xs ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                            {finding.fix}
                          </p>
                        </div>
                      )}

                      <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        Rule: {finding.ruleId} • Tool: {finding.tool}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {status === 'complete' && filteredFindings.length === 0 && findings.length > 0 && (
        <div className={`px-3 py-8 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          No {filterSeverity} findings
        </div>
      )}

      {status === 'complete' && findings.length === 0 && (
        <div className={`px-3 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          <div className="text-3xl mb-2">✅</div>
          <div className="text-sm">No security issues found</div>
          <div className="text-xs mt-1">Your code passed all security checks</div>
        </div>
      )}

      {status === 'idle' && (
        <div className={`px-3 py-8 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Click "Run Analysis" to scan for security issues
        </div>
      )}

      {/* Footer */}
      <div className={`px-3 py-1.5 border-t text-xs ${
        isDark ? 'border-gray-700 text-gray-500' : 'border-gray-200 text-gray-400'
      }`}>
        Powered by custom Juicebox security rules
      </div>
    </div>
  )
}
